// 실제 PostgreSQL에 붙는 통합 테스트. TEST_DATABASE_URL의 DB는 매번 초기화되므로 이름이 _test로 끝나야 한다.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

const DB = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/pling_test';
if (!/_test$/.test(new URL(DB).pathname)) throw new Error('테스트 DB 이름은 _test로 끝나야 합니다');
process.env.DATABASE_URL = DB;
process.env.AUTH_DEV_SECRET = 'test-secret-only';
process.env.AUTH_ISSUER = '';

let base = '';
let close: () => Promise<void>;
let pool: import('pg').Pool;

before(async () => {
  ({ pool } = await import('../src/db'));
  await pool.query('drop schema public cascade; create schema public');
  await (await import('../src/migrate')).migrate();
  const app = await (await import('../src/app')).createApp();
  await app.listen(0);
  base = await app.getUrl();
  close = async () => { await app.close(); await pool.end(); };
});
after(() => close());

const token = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setExpirationTime('1h').sign(new TextEncoder().encode('test-secret-only'));
async function api(sub: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(sub ? { authorization: `Bearer ${await token(sub)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}
const plan = (o: object = {}) => ({ title: '영어 단어', date: '2026-11-18', start: '10:00', end: '11:00', color: '#FFB86B', ...o });

test('인증 없으면 401, 잘못된 토큰도 401', async () => {
  assert.equal((await api(null, 'GET', '/plans')).status, 401);
  const res = await fetch(base + '/plans', { headers: { authorization: 'Bearer nope' } });
  assert.equal(res.status, 401);
  assert.equal((await api(null, 'GET', '/health')).status, 200);
});

test('일정 CRUD · 서울 시간 → UTC 저장 · 날짜 조회', async () => {
  const c = await api('alice', 'POST', '/plans', plan());
  assert.equal(c.status, 201);
  assert.equal(c.body.startAt, '2026-11-18T01:00:00.000Z');
  assert.deepEqual([c.body.date, c.body.start, c.body.end, c.body.version], ['2026-11-18', '10:00', '11:00', 1]);

  const list = await api('alice', 'GET', '/plans?from=2026-11-18&to=2026-11-18');
  assert.equal(list.body.length, 1);
  assert.equal((await api('alice', 'GET', '/plans?from=2026-11-19&to=2026-11-19')).body.length, 0);
  assert.equal((await api('alice', 'GET', '/plans?from=2026-01-01&to=2026-12-31')).status, 400);

  const u = await api('alice', 'PATCH', `/plans/${c.body.id}`, { title: '영어 복습', start: '20:00', end: '21:00', version: 1 });
  assert.equal(u.status, 200);
  assert.deepEqual([u.body.title, u.body.start, u.body.version], ['영어 복습', '20:00', 2]);
  // 이전 버전으로 수정하면 충돌
  assert.equal((await api('alice', 'PATCH', `/plans/${c.body.id}`, { title: 'x', version: 1 })).status, 409);

  assert.equal((await api('alice', 'DELETE', `/plans/${c.body.id}`)).status, 204);
  assert.equal((await api('alice', 'DELETE', `/plans/${c.body.id}`)).status, 404);
});

test('입력 검증: 60자 · 끝<시작 · 색상 · 없는 날짜', async () => {
  assert.equal((await api('alice', 'POST', '/plans', plan({ title: 'a'.repeat(61) }))).status, 400);
  assert.equal((await api('alice', 'POST', '/plans', plan({ start: '11:00', end: '10:00' }))).status, 400);
  assert.equal((await api('alice', 'POST', '/plans', plan({ color: 'red' }))).status, 400);
  assert.equal((await api('alice', 'POST', '/plans', plan({ date: '2026-02-30' }))).status, 400);
});

test('겹침 거부 · 맞닿은 시간 허용 · 같은 색 허용 · 다른 사용자와는 무관', async () => {
  const d = { date: '2026-11-20' };
  assert.equal((await api('alice', 'POST', '/plans', plan({ ...d, start: '09:00', end: '10:00' }))).status, 201);
  assert.equal((await api('alice', 'POST', '/plans', plan({ ...d, start: '09:30', end: '10:30' }))).status, 409);
  assert.equal((await api('alice', 'POST', '/plans', plan({ ...d, start: '10:00', end: '11:00' }))).status, 201);
  assert.equal((await api('bob', 'POST', '/plans', plan({ ...d, start: '09:00', end: '10:00' }))).status, 201);
});

test('동시에 같은 시간 일정 10개 생성 → 1개만 성공(DB 제약)', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, () => api('carol', 'POST', '/plans', plan({ date: '2026-11-21' }))));
  assert.equal(rs.filter((r) => r.status === 201).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 9);
});

test('다른 사용자의 일정·세션·목표에 접근 불가', async () => {
  const p = (await api('alice', 'POST', '/plans', plan({ date: '2026-11-22' }))).body;
  const g = (await api('alice', 'POST', '/goals', { title: '수학 1단원' })).body;
  assert.equal((await api('bob', 'PATCH', `/plans/${p.id}`, { title: 'hack' })).status, 404);
  assert.equal((await api('bob', 'DELETE', `/plans/${p.id}`)).status, 404);
  assert.equal((await api('bob', 'POST', `/plans/${p.id}/focus`)).status, 404);
  assert.equal((await api('bob', 'PATCH', `/goals/${g.id}`, { done: true })).status, 404);
  const s = (await api('alice', 'POST', `/plans/${p.id}/focus`)).body;
  assert.equal((await api('bob', 'GET', `/focus/${s.id}`)).status, 404);
  assert.equal((await api('bob', 'POST', `/focus/${s.id}/complete`)).status, 404);
  assert.equal((await api('bob', 'POST', `/plans/${p.id}/reward`)).status, 409);
  assert.equal((await api('bob', 'GET', '/plans/not-a-uuid')).status, 404);
});

test('집중: 진입만으로 시작 안 함 → ▶ → 멈춤/재개 → ✓ → 5코인 1회', async () => {
  const p = (await api('dave', 'POST', '/plans', plan({ date: '2026-11-23', start: '10:00', end: '10:25' }))).body;
  const s = (await api('dave', 'POST', `/plans/${p.id}/focus`)).body;
  assert.deepEqual([s.status, s.durationSec, s.remainingSec, s.startedAt], ['READY', 1500, 1500, null]);
  // 다시 열어도 같은 세션
  assert.equal((await api('dave', 'POST', `/plans/${p.id}/focus`)).body.id, s.id);
  // 시작 전엔 시간이 흐르지 않음
  await pool.query(`update focus_sessions set created_at = now() - interval '10 minutes' where id = $1`, [s.id]);
  assert.equal((await api('dave', 'GET', `/focus/${s.id}`)).body.remainingSec, 1500);
  // 완료 전 보상 불가, 시작 전 완료 불가
  assert.equal((await api('dave', 'POST', `/plans/${p.id}/reward`)).status, 409);
  assert.equal((await api('dave', 'POST', `/focus/${s.id}/complete`)).status, 409);

  assert.equal((await api('dave', 'POST', `/focus/${s.id}/start`)).body.status, 'RUNNING');
  // 5분 진행한 것으로 시각을 당겨 서버 기준 남은 시간 복원 확인
  await pool.query(`update focus_sessions set started_at = started_at - interval '300 seconds' where id = $1`, [s.id]);
  const left = (await api('dave', 'GET', `/focus/${s.id}`)).body.remainingSec;
  assert.ok(left <= 1200 && left >= 1198, `remaining ${left}`);

  const paused = (await api('dave', 'POST', `/focus/${s.id}/pause`)).body;
  assert.equal(paused.status, 'PAUSED');
  await pool.query(`update focus_sessions set started_at = started_at - interval '600 seconds', paused_at = paused_at - interval '600 seconds' where id = $1`, [s.id]);
  // 멈춘 동안은 줄지 않음
  assert.equal((await api('dave', 'GET', `/focus/${s.id}`)).body.remainingSec, paused.remainingSec);
  const resumed = (await api('dave', 'POST', `/focus/${s.id}/resume`)).body;
  assert.ok(Math.abs(resumed.remainingSec - paused.remainingSec) <= 1);

  // 연타: 완료 요청 5번 동시에 → 모두 COMPLETED, 계획 완료
  const done = await Promise.all(Array.from({ length: 5 }, () => api('dave', 'POST', `/focus/${s.id}/complete`)));
  assert.ok(done.every((r) => r.status === 200 && r.body.status === 'COMPLETED'));
  const planNow = (await api('dave', 'GET', '/plans?from=2026-11-23&to=2026-11-23')).body[0];
  assert.equal(planNow.done, true);
  assert.equal(planNow.version, 2);

  // 수령 동시 10번 → 1번만 지급
  const claims = await Promise.all(Array.from({ length: 10 }, () => api('dave', 'POST', `/plans/${p.id}/reward`)));
  assert.equal(claims.filter((r) => r.body.granted).length, 1);
  assert.equal((await api('dave', 'GET', '/rewards')).body.balance, 5);

  // 완료 취소 → 다시 집중 → 재완료 → 추가 지급 없음
  await api('dave', 'PATCH', `/plans/${p.id}`, { done: false });
  const s2 = (await api('dave', 'POST', `/plans/${p.id}/focus`)).body;
  assert.notEqual(s2.id, s.id);
  await api('dave', 'POST', `/focus/${s2.id}/start`);
  await api('dave', 'POST', `/focus/${s2.id}/complete`);
  const again = await api('dave', 'POST', `/plans/${p.id}/reward`);
  assert.deepEqual([again.body.granted, again.body.balance], [false, 5]);
  // 계획을 지워도 원장 유지
  await api('dave', 'DELETE', `/plans/${p.id}`);
  assert.equal((await api('dave', 'GET', '/me')).body.coins, 5);
});

test('넘기기 후에는 완료·보상 불가', async () => {
  const p = (await api('erin', 'POST', '/plans', plan())).body;
  const s = (await api('erin', 'POST', `/plans/${p.id}/focus`)).body;
  assert.equal((await api('erin', 'POST', `/focus/${s.id}/skip`)).body.status, 'SKIPPED');
  assert.equal((await api('erin', 'POST', `/focus/${s.id}/start`)).status, 409);
  assert.equal((await api('erin', 'POST', `/plans/${p.id}/reward`)).status, 409);
  assert.equal((await api('erin', 'POST', `/focus/${s.id}/dance`)).status, 404);
});

test('목표 CRUD', async () => {
  const g = (await api('frank', 'POST', '/goals', { title: '모의고사', date: '2026-12-01' })).body;
  assert.deepEqual([g.title, g.date, g.done], ['모의고사', '2026-12-01', false]);
  const u = (await api('frank', 'PATCH', `/goals/${g.id}`, { done: true, date: null })).body;
  assert.deepEqual([u.done, u.date, u.title], [true, null, '모의고사']);
  assert.equal((await api('frank', 'GET', '/goals')).body.length, 1);
  assert.equal((await api('frank', 'DELETE', `/goals/${g.id}`)).status, 204);
});

test('설문 → 사분면 4유형 · q3 미응답', async () => {
  const cases: [number[], number | null, string | null][] = [
    [[2], 0, 'calm_designer'], [[0], 0, 'steady_doer'], [[3], 1, 'free_explorer'], [[1, 2], 1, 'flexible_challenger'], [[0], null, null],
  ];
  for (const [q2, q3, type] of cases) {
    const r = await api('gina', 'POST', '/survey', { q1: 1, q2, q3 });
    assert.equal(r.status, 201);
    assert.equal(r.body.result?.type ?? null, type);
  }
  assert.equal((await api('gina', 'GET', '/survey/latest')).body.result, null);
  assert.equal((await api('gina', 'POST', '/survey', { q1: 9, q2: [0, 0], q3: 2 })).status, 400);
});

test('설정: 프로필·타임존·알림/테마 선호', async () => {
  const me = (await api('hana', 'GET', '/me')).body;
  assert.deepEqual([me.timeZone, me.preferences.theme, me.preferences.notifications.enabled, me.coins], ['Asia/Seoul', 'system', false, 0]);
  const prefs = { theme: 'dark', notifications: { enabled: true, atStart: true, before: 10, sound: false } };
  const u = (await api('hana', 'PATCH', '/me', { displayName: '하나', preferences: prefs })).body;
  assert.deepEqual([u.displayName, u.preferences], ['하나', prefs]);
  assert.equal((await api('hana', 'PATCH', '/me', { timeZone: 'Mars/Base' })).status, 400);
  assert.equal((await api('hana', 'PATCH', '/me', { preferences: { ...prefs, notifications: { ...prefs.notifications, before: 7 } } })).status, 400);
  // 타임존을 바꾸면 같은 UTC 일정이 그 시간대로 보인다
  await api('hana', 'POST', '/plans', plan({ date: '2026-11-25', start: '10:00', end: '11:00' }));
  await api('hana', 'PATCH', '/me', { timeZone: 'UTC' });
  const p = (await api('hana', 'GET', '/plans?from=2026-11-25&to=2026-11-25')).body[0];
  assert.deepEqual([p.start, p.end], ['01:00', '02:00']);
});
