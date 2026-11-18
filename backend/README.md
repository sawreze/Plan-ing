# 플잉 백엔드 (Spring Boot)

Java 25 · Spring Boot 4.1 · PostgreSQL · Flyway. ORM 없이 `JdbcClient` + SQL. 인증은 관리형 인증(예: Supabase Auth)의 JWT를 검증하는 경계만 있다.
이전 NestJS 버전은 `_이전자료/2026-11-18-nestjs/`에 보관(동일 API·스키마).

## 로컬 실행 (에뮬레이터 확인용)

```sh
createdb pling                 # 처음 한 번
./run-local.sh                 # 빌드 + 실행. Flyway가 스키마를 자동 적용
```

- 테스트 화면: http://localhost:8080 (로그인·계획·집중 타이머·코인·목표·설문·요청 기록)
- iOS 시뮬레이터: `http://localhost:8080`, 안드로이드 에뮬레이터: `http://10.0.2.2:8080`
- 맥 기본 Java가 1.8이면 스크립트가 Android Studio에 들어 있는 Java를 쓴다.
- `target/`은 iCloud 동기화 폴더(데스크톱) 밖 `~/Library/Caches/pling-backend-target`을 가리키는 링크다. 데스크톱 안에 빌드하면 iCloud가 `X 2.class` 중복 파일을 만들어 빌드가 깨진다.

테스트(실제 PostgreSQL, `_test`로 끝나는 DB를 매번 초기화):

```sh
createdb pling_test
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./mvnw test
```

## 환경 변수 (값은 서버 비밀 저장소에)

| 이름 | 설명 |
| --- | --- |
| `DATABASE_URL` · `DB_USER` · `DB_PASSWORD` | JDBC URL(기본 `jdbc:postgresql://localhost:5432/pling`). `btree_gist` 확장 필요 |
| `PORT` | 기본 8080 |
| `AUTH_JWKS_URL` / `AUTH_ISSUER` / `AUTH_AUDIENCE` | 운영 토큰 검증. Supabase면 `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`, issuer `.../auth/v1`, audience `authenticated` |
| `AUTH_DEV_SECRET` | 로컬 전용 HS256 비밀값(32자 이상). 설정 시 `POST /dev/token {nickname}` 테스트 로그인이 열림. `prod` 프로필이면 기동 거부 |
| `CORS_ORIGINS` | 쉼표 구분 허용 출처 |

## API (모두 `Authorization: Bearer <JWT>`, `/health`·`/dev/token` 제외)

사용자는 토큰의 `sub`로만 식별한다. 첫 요청 때 프로필이 자동 생성된다(기본 `Asia/Seoul`). 다른 사용자 자원은 404.

| 메서드 · 경로 | 설명 |
| --- | --- |
| `GET /me` · `PATCH /me` | 표시 이름(""이면 지움), `timeZone`, `preferences`({theme, notifications:{enabled,atStart,before:0/5/10/15,sound}}), `coins` |
| `GET /plans?from=YYYY-MM-DD&to=YYYY-MM-DD` | 사용자 타임존 기준 날짜 구간(최대 62일, 생략 시 오늘) |
| `POST /plans` | `{title(≤60), date, start:"HH:mm", end, color:"#RRGGBB"}`. 겹치면 409, 같은 색 허용 |
| `PATCH /plans/:id` | 부분 수정 + `done`. `version`을 보냈는데 다르면 409 |
| `DELETE /plans/:id` | 204 |
| `POST /plans/:id/focus` | 집중창 열기 → READY 세션(이미 있으면 그 세션). **시간 안 흐름** |
| `GET /focus/:id` | 서버 기준 `remainingSec` 복원 |
| `POST /focus/:id/{start,pause,resume,complete,skip}` | ▶ 시작·멈춤·재개·✓완료·넘기기. 같은 요청 재전송은 현재 상태 반환. 완료 시 계획 `done=true` |
| `POST /plans/:id/reward` | 완료된 세션이 있어야 함. `{granted, amount:5, balance}`. 몇 번 불러도 1회 지급 |
| `GET /rewards` | 잔액(원장 합계)과 최근 50건 |
| `GET/POST /goals`, `PATCH/DELETE /goals/:id` | 개인 목표(`date: ""`이면 목표일 지움) |
| `POST /survey` · `GET /survey/latest` | `{q1:0-4|null, q2:[0-3...], q3:0|1|null}` → 사분면 4유형(규칙 v1, HTML `computeStudyType`과 동일). 진단 아님 |

## 보장 방식

- 일정 겹침: PostgreSQL `EXCLUDE USING gist` 제약(`[start,end)`, 완료 여부 무관). 동시 요청에도 유지.
- 보상: `reward_ledger (user_id, plan_id, reason)` UNIQUE + `on conflict do nothing`. 잔액은 원장 합계. 계획을 지워도 원장이 남아 재지급 불가.
- 집중 상태: 행 잠금(`for update`) 안에서 전환. 계획당 진행 중 세션 1개(부분 UNIQUE 인덱스). 남은 시간은 DB 시계 기준.
- 첫 요청이 동시에 와도 프로필은 하나만 생긴다(`on conflict do update`로 상대 트랜잭션을 기다림).

## 검증 기록 (2026-11-19)

- `./mvnw test` 11/11 통과: 401, 일정 CRUD·UTC 저장, 입력 검증, 겹침/맞닿음/같은 색, 동시 생성 10건 중 1건, 타 사용자 접근 404, 진입만으로 시작 안 함·멈춤/재개 복원·완료 연타 5회·수령 동시 10회 중 1회·완료 취소 후 재완료 무지급·계획 삭제 후 잔액 유지, 넘기기, 목표, 설문 4유형/q3 미응답, 설정/타임존.
- 테스트 중 발견·수정: 새 사용자의 첫 요청이 동시에 오면 프로필 생성이 충돌해 500이 나던 문제(NestJS 버전에도 있었음).
- 브라우저 테스트 화면에서 로그인→계획 추가→▶→✓→코인 수령(2회째 "이미 받은 보상") 확인.
- iPhone 17 Pro 시뮬레이터: 로그인, 집중 탭 준비 상태(25:00 고정)→▶ 카운트다운→✓→기쁜 마스코트 축하→5코인(잔액 10) 확인.
- Android 에뮬레이터(API 37): 로그인, iOS에서 완료한 계획이 완료로 보임(서버 동기화), 계획 겹침 오류 문구 표시 확인.

## 아직 아님 (완료로 보지 말 것)

- 실제 Google/Apple/이메일 로그인 공급자 없음(JWT 검증 경계와 로컬 테스트 로그인만). 운영 JWKS는 실제 공급자로 시험하지 않음.
- Gemini 채팅, 크루, 푸시 알림 워커·APNs/FCM, 배포 없음.
- 미결정 정책: 조기 ✓ 완료 보상(시작 직후 ✓도 5코인 → 계획을 많이 만들면 코인 파밍 가능), 대화 저장 기간.
