import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, AuthUser, User } from './auth';
import { pool, tx } from './db';
import { dateStr, parse, timeStr } from './http';

const minutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const planInput = z.object({ title: z.string().trim().min(1).max(60), date: dateStr, start: timeStr, end: timeStr, color });
const planPatch = planInput.partial().extend({ done: z.boolean().optional(), version: z.number().int().optional() });
const checkTimes = (p: { start: string; end: string }) => {
  // 자정을 넘는 일정은 현재 UI와 같이 지원하지 않는다.
  if (minutes(p.end) <= minutes(p.start)) throw new BadRequestException('끝 시간을 시작 시간 뒤로 정해주세요');
};

// 응답은 현재 HTML의 events 필드(date/start/end 문자열)와 ISO 시각을 함께 준다. $2 = 사용자 time_zone
const planCols = `id, title, color, done, version, start_at "startAt", end_at "endAt",
  to_char(start_at at time zone $2, 'YYYY-MM-DD') date, to_char(start_at at time zone $2, 'HH24:MI') start,
  to_char(end_at at time zone $2, 'HH24:MI') "end"`;
const at = (d: string, t: string) => `(${d}::date + ${t}::time) at time zone $2`;

const sessionCols = `id, plan_id "planId", status, duration_sec "durationSec", started_at "startedAt", ended_at "endedAt",
  case when status = 'COMPLETED' then 0 else greatest(0, duration_sec - case when started_at is null then 0 else
    extract(epoch from coalesce(ended_at, paused_at, now()) - started_at)::int - paused_total_sec end) end "remainingSec"`;

const REWARD = { reason: 'focus_complete', amount: 5 };

@Controller()
@UseGuards(AuthGuard)
export class PlansController {
  @Get('plans')
  async list(@User() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), { from, to });
    const days = q.from && q.to ? (Date.parse(q.to) - Date.parse(q.from)) / 864e5 : 0;
    if (!(days >= 0 && days <= 62)) throw new BadRequestException('조회 기간은 0~62일이에요');
    const { rows } = await pool.query(
      `select ${planCols} from plans where user_id = $1
         and start_at >= coalesce($3::date, (now() at time zone $2)::date) at time zone $2
         and start_at < (coalesce($4::date, $3::date, (now() at time zone $2)::date) + 1) at time zone $2
       order by start_at`,
      [u.id, u.timeZone, q.from ?? null, q.to ?? null],
    );
    return rows;
  }

  @Post('plans')
  async create(@User() u: AuthUser, @Body() body: unknown) {
    const p = parse(planInput, body);
    checkTimes(p);
    const { rows } = await pool.query(
      `insert into plans (user_id, title, start_at, end_at, color) values ($1, $3, ${at('$4', '$5')}, ${at('$4', '$6')}, $7) returning ${planCols}`,
      [u.id, u.timeZone, p.title, p.date, p.start, p.end, p.color],
    );
    return rows[0];
  }

  @Patch('plans/:id')
  update(@User() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const patch = parse(planPatch, body);
    return tx(async (c) => {
      const cur = (await c.query(`select ${planCols} from plans where id = $3 and user_id = $1 for update`, [u.id, u.timeZone, id])).rows[0];
      if (!cur) throw new NotFoundException('계획을 찾을 수 없어요');
      // 다른 기기/AI 제안이 먼저 바꿨으면 덮어쓰지 않는다.
      if (patch.version !== undefined && patch.version !== cur.version) throw new ConflictException({ message: '다른 곳에서 계획이 바뀌었어요', plan: cur });
      const n = { ...cur, ...patch };
      checkTimes(n);
      const { rows } = await c.query(
        `update plans set title = $3, start_at = ${at('$4', '$5')}, end_at = ${at('$4', '$6')}, color = $7, done = $8,
           version = version + 1, updated_at = now() where id = $9 and user_id = $1 returning ${planCols}`,
        [u.id, u.timeZone, n.title, n.date, n.start, n.end, n.color, n.done, id],
      );
      return rows[0];
    });
  }

  @Delete('plans/:id')
  @HttpCode(204)
  async remove(@User() u: AuthUser, @Param('id') id: string) {
    const r = await pool.query('delete from plans where id = $1 and user_id = $2', [id, u.id]);
    if (!r.rowCount) throw new NotFoundException('계획을 찾을 수 없어요');
  }

  // 집중창 열기: READY 세션만 만든다. 시간은 ▶(start) 전까지 흐르지 않는다.
  @Post('plans/:id/focus')
  openFocus(@User() u: AuthUser, @Param('id') id: string) {
    return tx(async (c) => {
      const plan = (await c.query('select done, extract(epoch from end_at - start_at)::int sec from plans where id = $1 and user_id = $2 for update', [id, u.id])).rows[0];
      if (!plan) throw new NotFoundException('계획을 찾을 수 없어요');
      const active = await c.query(`select ${sessionCols} from focus_sessions where plan_id = $1 and status in ('READY','RUNNING','PAUSED')`, [id]);
      if (active.rows[0]) return active.rows[0];
      if (plan.done) throw new ConflictException('이미 완료한 계획이에요');
      const { rows } = await c.query(`insert into focus_sessions (user_id, plan_id, duration_sec) values ($1, $2, $3) returning ${sessionCols}`, [u.id, id, plan.sec]);
      return rows[0];
    });
  }

  @Get('focus/:id')
  async getFocus(@User() u: AuthUser, @Param('id') id: string) {
    const { rows } = await pool.query(`select ${sessionCols} from focus_sessions where id = $1 and user_id = $2`, [id, u.id]);
    if (!rows[0]) throw new NotFoundException('집중 기록을 찾을 수 없어요');
    return rows[0];
  }

  // 상태 전환. 같은 요청 재전송(연타·네트워크 재시도)은 현재 상태를 그대로 돌려준다.
  @Post('focus/:id/:action')
  @HttpCode(200)
  act(@User() u: AuthUser, @Param('id') id: string, @Param('action') action: string) {
    const rule = TRANSITIONS[action];
    if (!rule) throw new NotFoundException();
    return tx(async (c) => {
      const s = (await c.query('select status, plan_id from focus_sessions where id = $1 and user_id = $2 for update', [id, u.id])).rows[0];
      if (!s) throw new NotFoundException('집중 기록을 찾을 수 없어요');
      if (s.status !== rule.to) {
        if (!rule.from.includes(s.status)) throw new ConflictException(`지금 상태(${s.status})에서는 할 수 없어요`);
        await c.query(`update focus_sessions set status = $2, ${rule.set} where id = $1`, [id, rule.to]);
        if (rule.to === 'COMPLETED') await c.query('update plans set done = true, version = version + 1, updated_at = now() where id = $1 and not done', [s.plan_id]);
      }
      return (await c.query(`select ${sessionCols} from focus_sessions where id = $1`, [id])).rows[0];
    });
  }

  // 5코인 수령. 완료된 집중 세션이 있어야 하고, (user, plan, reason) 유일 키로 한 번만 지급된다.
  @Post('plans/:id/reward')
  @HttpCode(200)
  async claim(@User() u: AuthUser, @Param('id') id: string) {
    const s = (await pool.query(`select id from focus_sessions where plan_id = $1 and user_id = $2 and status = 'COMPLETED' limit 1`, [id, u.id])).rows[0];
    if (!s) throw new ConflictException('집중을 완료한 계획만 보상을 받을 수 있어요');
    const ins = await pool.query(
      'insert into reward_ledger (user_id, plan_id, session_id, reason, amount) values ($1, $2, $3, $4, $5) on conflict do nothing',
      [u.id, id, s.id, REWARD.reason, REWARD.amount],
    );
    return { granted: ins.rowCount === 1, amount: REWARD.amount, balance: await balance(u.id) };
  }

  @Get('rewards')
  async rewards(@User() u: AuthUser) {
    const { rows } = await pool.query(`select plan_id "planId", reason, amount, created_at "createdAt" from reward_ledger where user_id = $1 order by id desc limit 50`, [u.id]);
    return { balance: await balance(u.id), ledger: rows };
  }
}

export async function balance(userId: string): Promise<number> {
  return (await pool.query('select coalesce(sum(amount), 0)::int b from reward_ledger where user_id = $1', [userId])).rows[0].b;
}

const fold = `paused_total_sec = paused_total_sec + coalesce(extract(epoch from now() - paused_at)::int, 0), paused_at = null`;
const TRANSITIONS: Record<string, { from: string[]; to: string; set: string }> = {
  start: { from: ['READY'], to: 'RUNNING', set: 'started_at = now()' },
  pause: { from: ['RUNNING'], to: 'PAUSED', set: 'paused_at = now()' },
  resume: { from: ['PAUSED'], to: 'RUNNING', set: fold },
  // 현재 UI 정책: 시간 종료 또는 수동 ✓(조기 완료) 모두 완료. 조기 완료 보상 제한은 미결정 제품 정책.
  complete: { from: ['RUNNING', 'PAUSED'], to: 'COMPLETED', set: `${fold}, ended_at = now()` },
  skip: { from: ['READY', 'RUNNING', 'PAUSED'], to: 'SKIPPED', set: `${fold}, ended_at = now()` },
};
