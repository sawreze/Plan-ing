# 플잉 서버

Node.js 24 이상에서 실행하는 NestJS·PostgreSQL 서버입니다. SQL을 직접 사용하며, 마이그레이션은 파일 체크섬과 DB 잠금으로 적용합니다.

## 시작

```sh
npm ci
./run-local.sh
```

Docker Desktop이 켜져 있어야 합니다. PostgreSQL은 맥의 `127.0.0.1:54329`에 연결되고, API는 `127.0.0.1:8080`에서 뜹니다. `.env`가 이미 있으면 setup 스크립트가 덮어쓰지 않습니다. 기존 DB를 사용한다면 DATABASE_URL을 맞춘 뒤 다음처럼 실행하세요.

```sh
npm run build
npm run migrate
npm start
```

## 환경 변수

| 변수 | 용도 |
| --- | --- |
| DATABASE_URL | PostgreSQL 연결 문자열 |
| DATABASE_SSL | 관리형 DB의 TLS가 필요하면 require |
| AUTH_MODE | local 또는 supabase |
| AUTH_SECRET | local JWT 서명용, 최소 32자. setup은 임의 값 생성 |
| AUTH_ISSUER / AUTH_AUDIENCE | Supabase issuer와 audience, JWKS는 issuer 아래에서 조회 |
| GEMINI_API_KEY / GEMINI_MODEL | 서버에서 사용할 Gemini 키와 실제 지원 모델 ID |
| APNS_KEY_FILE / APNS_KEY_ID / APNS_TEAM_ID / APNS_TOPIC | Apple 발급 키 파일과 앱 식별자 |
| APNS_SANDBOX | 개발 APNs를 쓰면 true |
| HOST / PORT | 기본 127.0.0.1:8080. 외부 공개는 별도 운영 설정 필요 |
| CORS_ORIGINS | 필요한 웹 출처를 쉼표로 나열. 기본은 교차 출처 허용 없음 |

.env.example에는 이름과 예시만 있습니다. 비밀값은 커밋하지 마세요. 운영에서는 HTTPS 앞단, 공유 요청 제한, 비밀 저장소와 DB 백업을 구성해야 합니다. local 인증 토큰은 12시간 유효하며 refresh·기기별 강제 로그아웃은 아직 없습니다.

## 요청 형식

인증을 제외한 API는 `Authorization: Bearer <token>`이 필요합니다. 날짜는 YYYY-MM-DD, 시간은 HH:mm, 색은 #RRGGBB입니다. 사용자는 토큰에서 결정하며 요청의 userId를 신뢰하지 않습니다.

### 인증·프로필

| 요청 | 내용 |
| --- | --- |
| POST /auth/register | {email,password,displayName}, 비밀번호 10~128자 |
| POST /auth/login | {email,password} → {token,expiresIn} |
| GET /auth/config | 현재 인증 모드 |
| GET /health | DB 연결 상태 |
| GET /me | 프로필·설정·코인 |
| PATCH /me | {displayName?,timeZone?,preferences?} |

preferences는 {theme,notifications:{enabled,atStart,before,sound}}입니다. before는 0/5/10/15분입니다. 기기의 OS 권한과는 별도입니다.

### 일정·집중·보상

| 요청 | 내용 |
| --- | --- |
| GET /plans?from=YYYY-MM-DD&to=YYYY-MM-DD | 최대 62일. 생략 시 사용자 타임존의 오늘 |
| POST /plans | {title,date,start,end,color} |
| PATCH /plans/:id | 변경 필드와 **version 필수**. 예: {done:true,version:1} |
| DELETE /plans/:id | 계획 삭제. 코인 원장은 보존 |
| POST /plans/:id/focus | READY 생성 또는 현재 진행 세션 반환 |
| GET /focus/active | 내 대기·실행·중지 세션 |
| GET /focus/:id | 서버 시각으로 계산한 remainingSec |
| POST /focus/:id/start | ▶ 시작 |
| POST /focus/:id/pause | 멈춤 |
| POST /focus/:id/resume | 재개 |
| POST /focus/:id/complete | 완료 |
| POST /focus/:id/skip | 넘기기 |
| POST /plans/:id/reward | {granted,amount,balance}, 계획별 5코인 1회 |
| GET /rewards | 잔액과 최근 50건 원장 |

끝은 시작보다 뒤여야 하고 같은 날짜에서 자정을 넘지 않습니다. 시간 범위는 [시작,끝)이므로 끝나는 시각에 다음 계획을 만들 수 있습니다. 같은 색상 사용은 제한하지 않습니다. 계획 수정은 version을 검사하며, 실행 중인 계획의 시간을 바꾸는 요청은 거부합니다.

집중창 진입은 타이머 시작이 아닙니다. 시작 전 complete는 거부합니다. 현재 디자인처럼 시작 후 수동 ✓는 조기 완료도 허용하고 보상합니다. 이 정책을 제한하려면 제품 결정과 UI 변경을 함께 해야 합니다. 타이머 준비/중지 상태는 시간이 줄지 않으며, 실행 중에는 앱을 닫아도 서버 기준 시간이 흐릅니다.

### 목표·유형·크루

| 요청 | 내용 |
| --- | --- |
| GET/POST /goals | 목록 / {title,date?} |
| PATCH/DELETE /goals/:id | {title?,date?,done?} / 삭제 |
| POST /survey | {q1:0~4 또는 null,q2:[0~3],q3:0/1 또는 null} |
| GET /survey/latest | 최근 답변과 규칙 v1의 4유형 |
| GET/POST /crews | 내 크루 / {name,goal,category,date?,description?} |
| POST /crews/join | {code} |
| GET /crews/:id | 멤버만 상세 조회 |
| POST /crews/:id/goal | 공동 목표를 내 목표로 가져오기, 중복 방지 |
| POST /crews/:id/leave | 일반 멤버 탈퇴 |
| POST /crews/:id/invite | 크루장 참여 코드 갱신 |
| DELETE /crews/:id | 크루장 삭제 |

category는 자격증/시험 준비/공부 습관/독서/기타입니다. date를 비우려면 목표 수정에서 빈 문자열이나 null을 보냅니다. 유형 사분면은 설문 규칙이며 LLM 진단이 아닙니다.

### Gemini·알림

| 요청 | 내용 |
| --- | --- |
| POST /chat/messages | {message,conversationId?} → {reply,conversationId,proposal} |
| GET /chat/conversations | 내 대화 목록 |
| GET/DELETE /chat/conversations/:id | 메시지 조회 / 삭제 |
| POST /chat/proposals/:id/apply | 제안 확인 후 적용 |
| POST /chat/proposals/:id/cancel | 대기 중 제안 취소 |
| POST /devices | {platform:"ios",token} |
| DELETE /devices/:id | 내 기기 알림 중지 |

Gemini에는 사용자 오늘 일정과 해당 대화의 최근 메시지만 전달합니다. 반환값은 검증하고, 실제 일정 변경은 확인 API에서 소유권·대상 버전·시간 충돌을 다시 검사합니다. 제안은 30분 뒤 만료됩니다. 대화는 DB에 저장하며 삭제 API를 제공합니다. 운영 전 보관 기간·개인정보 안내와 사용자 동의를 정해야 합니다.

알림은 일정/설정 변경과 같은 트랜잭션에서 재예약합니다. 실제 발송은 아래 별도 프로세스가 담당합니다.

```sh
npm run worker
```

APNs 설정이 없으면 워커는 실행하지 않습니다. 전송 실패는 재시도하고 만료된 토큰은 중지합니다. 발송 성공 직후 프로세스가 죽는 경우 같은 요청이 재시도될 수 있어 전달을 정확히 한 번 보장하지 않습니다. 이벤트 ID와 collapse ID로 중복 영향을 줄입니다. Android FCM과 모바일 권한/토큰 등록은 아직 구현하지 않았습니다.

## 검증 범위

`npm test`는 PGlite의 실제 PostgreSQL 쿼리·제약으로 11개 서비스 통합 항목과 Nest 모듈 구성 1개을 검사합니다. Gemini·APNs는 테스트 대역을 사용합니다. 서버 포트 바인딩과 네이티브 PostgreSQL 실행은 현재 도구 환경에서 허용되지 않아 실제 HTTP 통합·일반 PostgreSQL 다중 연결 검증은 남아 있습니다. 앱 정적 분석은 통과했으며 에뮬레이터 빌드/실행은 별도 검증이 필요합니다.
