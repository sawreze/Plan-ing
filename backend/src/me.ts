import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, AuthUser, User } from './auth';
import { pool } from './db';
import { dateStr, parse } from './http';
import { balance } from './plans';

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const preferences = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  // OS 알림 권한과 별개인 사용자 선호. 기기 토큰은 5단계에서 devices 테이블로 분리.
  notifications: z.object({ enabled: z.boolean(), atStart: z.boolean(), before: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15)]), sound: z.boolean() }),
});
const profilePatch = z.object({
  displayName: z.string().trim().max(30).nullable().optional(),
  timeZone: z.string().refine(validTz, '알 수 없는 시간대').optional(),
  preferences: preferences.optional(),
});

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  @Get()
  async get(@User() u: AuthUser) {
    const { rows } = await pool.query(`select display_name "displayName", time_zone "timeZone", preferences from profiles where id = $1`, [u.id]);
    return { ...rows[0], coins: await balance(u.id) };
  }

  @Patch()
  async update(@User() u: AuthUser, @Body() body: unknown) {
    const p = parse(profilePatch, body);
    await pool.query(
      `update profiles set display_name = case when $2 then $3 else display_name end, time_zone = coalesce($4, time_zone), preferences = coalesce($5, preferences) where id = $1`,
      [u.id, p.displayName !== undefined, p.displayName ?? null, p.timeZone ?? null, p.preferences ?? null],
    );
    return this.get({ ...u, timeZone: p.timeZone ?? u.timeZone });
  }
}

const goalCols = `id, title, to_char(date, 'YYYY-MM-DD') date, done`;
const goalInput = z.object({ title: z.string().trim().min(1).max(60), date: dateStr.nullable().optional() });

@Controller('goals')
@UseGuards(AuthGuard)
export class GoalsController {
  @Get()
  async list(@User() u: AuthUser) {
    return (await pool.query(`select ${goalCols} from goals where user_id = $1 order by created_at`, [u.id])).rows;
  }

  @Post()
  async create(@User() u: AuthUser, @Body() body: unknown) {
    const g = parse(goalInput, body);
    return (await pool.query(`insert into goals (user_id, title, date) values ($1, $2, $3) returning ${goalCols}`, [u.id, g.title, g.date ?? null])).rows[0];
  }

  @Patch(':id')
  async update(@User() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const g = parse(goalInput.partial().extend({ done: z.boolean().optional() }), body);
    const { rows } = await pool.query(
      `update goals set title = coalesce($3, title), date = case when $4 then $5::date else date end, done = coalesce($6, done)
       where id = $1 and user_id = $2 returning ${goalCols}`,
      [id, u.id, g.title ?? null, g.date !== undefined, g.date ?? null, g.done ?? null],
    );
    if (!rows[0]) throw new NotFoundException('목표를 찾을 수 없어요');
    return rows[0];
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@User() u: AuthUser, @Param('id') id: string) {
    if (!(await pool.query('delete from goals where id = $1 and user_id = $2', [id, u.id])).rowCount) throw new NotFoundException('목표를 찾을 수 없어요');
  }
}

// 설문 → 공부 방식 사분면. design/pling-app.html의 computeStudyType과 같은 규칙(v1). 진단·검사 점수가 아니다.
export const STUDY_RULE_VERSION = 1;
const TYPES = {
  'false-true': 'calm_designer',     // 차분한 설계자
  'true-true': 'steady_doer',        // 차근차근 실천가
  'false-false': 'free_explorer',    // 자유로운 탐험가
  'true-false': 'flexible_challenger', // 유연한 도전가
} as const;
export function computeStudyType(q2: number[], q3: number | null) {
  if (q3 === null) return null; // q3 미응답이면 결과 점을 숨긴다
  const guided = q2.includes(0) || q2.includes(1), reset = q3 === 0;
  return { type: TYPES[`${guided}-${reset}`], x: guided ? 73 : 27, y: reset ? 27 : 73 };
}
const answers = z.object({
  q1: z.number().int().min(0).max(4).nullable(), // 학생/직업: 분류에는 쓰지 않음
  q2: z.array(z.number().int().min(0).max(3)).max(4).refine((a) => new Set(a).size === a.length, '중복 답변'),
  q3: z.number().int().min(0).max(1).nullable(),
});

@Controller('survey')
@UseGuards(AuthGuard)
export class SurveyController {
  @Post()
  async submit(@User() u: AuthUser, @Body() body: unknown) {
    const a = parse(answers, body);
    const result = computeStudyType(a.q2, a.q3);
    await pool.query('insert into survey_responses (user_id, rule_version, answers, study_type) values ($1, $2, $3, $4)', [u.id, STUDY_RULE_VERSION, a, result?.type ?? null]);
    return { ruleVersion: STUDY_RULE_VERSION, answers: a, result };
  }

  @Get('latest')
  async latest(@User() u: AuthUser) {
    const r = (await pool.query('select rule_version, answers from survey_responses where user_id = $1 order by created_at desc limit 1', [u.id])).rows[0];
    if (!r) throw new NotFoundException('아직 설문 답변이 없어요');
    return { ruleVersion: r.rule_version, answers: r.answers, result: computeStudyType(r.answers.q2, r.answers.q3) };
  }
}
