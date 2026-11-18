# 플잉 백엔드 (1~3단계)

TypeScript · NestJS 12 · PostgreSQL. ORM 없이 `pg` + SQL 마이그레이션. 인증은 관리형 인증(예: Supabase Auth)의 JWT를 검증하는 경계만 있다.

## 실행

```sh
cd backend
npm install
cp .env.example .env            # DATABASE_URL, AUTH_* 채우기
createdb pling
npm run migrate                 # migrations/*.sql 순서대로 1회 적용
npm run dev                     # http://localhost:3000/health
```

테스트(실제 PostgreSQL 사용, 이름이 `_test`로 끝나는 DB를 매번 초기화):

```sh
createdb pling_test
npm test                        # TEST_DATABASE_URL로 DB 변경 가능
```

## 환경 변수 (값은 서버 비밀 저장소에)

| 이름 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 연결 문자열. `btree_gist` 확장 필요(대부분의 관리형 PG 지원) |
| `PORT` | 기본 3000 |
| `AUTH_JWKS_URL` / `AUTH_ISSUER` / `AUTH_AUDIENCE` | 운영 토큰 검증. Supabase면 `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`, issuer `.../auth/v1`, audience `authenticated` |
| `AUTH_DEV_SECRET` | 로컬·테스트 전용 HS256 비밀값. `NODE_ENV=production`이면 기동 거부 |
| `CORS_ORIGINS` | 쉼표 구분 허용 출처 |

## API (모두 `Authorization: Bearer <JWT>`, `/health` 제외)

사용자는 토큰의 `sub`로만 식별한다. 첫 요청 때 프로필이 자동 생성된다(기본 `Asia/Seoul`). 다른 사용자 자원은 404.

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /me` · `PATCH /me` | 표시 이름, `timeZone`, `preferences`({theme, notifications:{enabled,atStart,before:0/5/10/15,sound}}), `coins` |
| `GET /plans?from=YYYY-MM-DD&to=YYYY-MM-DD` | 사용자 타임존 기준 날짜 구간(최대 62일, 생략 시 오늘) |
| `POST /plans` | `{title(≤60), date, start:"HH:mm", end, color:"#RRGGBB"}`. 겹치면 409, 같은 색 허용 |
| `PATCH /plans/:id` | 부분 수정 + `done`. `version`을 보내면 다르면 409(+최신 plan) |
| `DELETE /plans/:id` | 204 |
| `POST /plans/:id/focus` | 집중창 열기 → READY 세션(이미 있으면 그 세션). **시간 안 흐름** |
| `GET /focus/:id` | 서버 기준 `remainingSec` 복원 |
| `POST /focus/:id/{start,pause,resume,complete,skip}` | ▶ 시작·멈춤·재개·✓완료·넘기기. 같은 요청 재전송은 현재 상태 반환. 완료 시 계획 `done=true` |
| `POST /plans/:id/reward` | 완료된 세션이 있어야 함. `{granted, amount:5, balance}`. 몇 번 불러도 1회 지급 |
| `GET /rewards` | 잔액(원장 합계)과 최근 50건 |
| `GET/POST /goals`, `PATCH/DELETE /goals/:id` | 개인 목표 |
| `POST /survey` · `GET /survey/latest` | `{q1:0-4|null, q2:[0-3...], q3:0|1|null}` → 사분면 4유형(규칙 v1, HTML `computeStudyType`과 동일). 진단 아님 |

응답의 일정은 현재 HTML `events`와 같은 `date/start/end` 문자열과 ISO `startAt/endAt`, `version`을 함께 준다. 프런트의 `loadPlanner/persistPlanner`, `#eventForm`, `prepareRun/startRun/finishRun`, `#claimCoins`, `notifyPrefs`를 이 API로 바꾸면 된다(아직 HTML은 연결하지 않음).

## 보장 방식

- 일정 겹침: PostgreSQL `EXCLUDE USING gist` 제약(`[start,end)`, 완료 여부 무관). 동시 요청에도 유지.
- 보상: `reward_ledger (user_id, plan_id, reason)` UNIQUE + `on conflict do nothing`. 잔액은 원장 합계라 캐시 불일치가 없다. 계획을 지워도 원장은 남아 재지급 불가.
- 집중 상태: 행 잠금(`for update`) 안에서 전환. 계획당 진행 중 세션 1개(부분 UNIQUE 인덱스). 남은 시간 = 길이 − (지금/멈춘 시각 − 시작) + 멈춘 누적, DB 시계 기준.
- 앱을 닫아도 RUNNING이면 시간은 흐르고 PAUSED일 때만 멈춘다(설계 추천안).

## 테스트 결과 (2026-11-18, PostgreSQL 18.6 로컬)

`npm test` 11/11 통과: 401 처리, 일정 CRUD·UTC 저장, 입력 검증, 겹침/맞닿음/같은 색, 동시 생성 10건 중 1건만 성공, 타 사용자 접근 404, 진입만으로 시작 안 함·멈춤/재개 복원·완료 연타·수령 동시 10회 중 1회·완료 취소 후 재완료 무지급·계획 삭제 후 잔액 유지, 넘기기, 목표, 설문 4유형/q3 미응답, 설정/타임존.

## 아직 아님 (완료로 보지 말 것)

- 실제 Google/Apple/이메일 로그인 공급자 설정 없음(JWT 검증 경계만). 운영 JWKS 검증은 실제 공급자로 시험하지 않음.
- HTML 프런트 연결, 로컬 데이터 가져오기(예시 일정·로컬 코인은 신뢰하지 않음) 없음.
- 4단계 Gemini, 5단계 크루·알림 워커·APNs, 배포 없음.
- 미결정 정책: 조기 ✓ 완료 보상 제한(현재는 시작 직후 ✓도 5코인 → 계획을 많이 만들면 코인 파밍 가능), 재접속 중 타이머 경과, 대화 저장 기간.
