# 플잉

ADHD를 위한 일정·공부 메이트입니다. 계획을 작게 나누고, 집중한 기록을 남기고, 공부 고민을 편하게 이야기하는 앱을 만들고 있습니다.

이 브랜치에는 NestJS 서버와 Flutter 앱이 있습니다. 기존 HTML은 디자인 기준으로 남겨뒀습니다. Flutter 화면은 서버 연동이 가능한 모바일 구현이며, HTML의 모든 화면을 그대로 옮긴 상태는 아닙니다.

## 맥에서 실행하기

Node.js 24 이상, Docker Desktop, Flutter SDK가 필요합니다. Docker Desktop을 먼저 켜주세요.

```sh
cd backend
npm ci
./run-local.sh
```

처음 실행하면 로컬 비밀값을 담은 `.env`를 만들고 PostgreSQL을 올린 뒤 마이그레이션을 적용합니다. 서버 주소는 `http://localhost:8080`, 상태 확인은 `/health`입니다.

다른 터미널에서 앱을 실행합니다.

```sh
cd app
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:8080
```

Android Studio의 Device Manager에서 에뮬레이터를 켜고, Flutter 장치 목록에서 선택하면 됩니다. iOS 시뮬레이터를 쓸 때는 API_URL을 `http://localhost:8080`으로 바꿉니다. Android Studio에서는 Flutter·Dart 플러그인을 설치한 뒤 `app/` 폴더를 여세요.

앱에서 이메일과 비밀번호로 계정을 만들 수 있습니다. 테스트 닉네임을 넣어 로그인하는 방식은 사용하지 않습니다.

## 지금 들어 있는 기능

- 비밀번호 해시와 JWT를 사용하는 이메일 가입·로그인, 사용자별 데이터 분리
- 계획 추가·조회·수정·삭제, 같은 시간의 일정 충돌 방지
- ▶를 눌러 시작하는 집중 타이머, 멈춤·재개·완료·넘기기
- 같은 계획에서 한 번만 받는 5코인, 목표와 설문 결과 저장
- 크루 생성·코드 참여·멤버 조회·공동 목표 가져오기
- Gemini 대화와 일정 변경 제안, 확인 후 적용
- 알림 설정·기기 등록·DB 예약과 APNs 발송 워커

Gemini와 실제 푸시는 키를 넣어야 동작합니다. 키가 없을 때 가짜 답변이나 발송 성공을 돌려주지 않습니다. Google·Apple 로그인은 Supabase JWT 검증 경계까지 있으며 Flutter의 소셜 로그인 화면은 아직 연결하지 않았습니다. 모바일 앱의 푸시 권한·토큰 등록도 후속 작업입니다.

## 검사하기

```sh
cd backend
npm ci
npm test
```

별도 DB 없이 PGlite(PostgreSQL의 WebAssembly 빌드)에서 스키마와 서비스 로직을 검사합니다. 테스트는 일반 PostgreSQL의 다중 연결이나 실제 HTTP·기기 검증을 대신하지 않습니다. 이 작업 환경에서는 서버 포트 바인딩과 에뮬레이터 실행 권한이 막혀 실제 기기 실행까지 검증하지 못했습니다.

Flutter는 정적 분석을 통과했습니다. 기기에서의 레이아웃, APK/iOS 빌드, 실사용자 로그인 공급자, 실제 Gemini 응답과 APNs 발송은 추가 확인이 필요합니다.

## 파일 안내

- [backend/](backend/) — 서버, SQL 마이그레이션, 테스트와 실행 설정
- [서버 API](backend/README.md) — 요청 경로와 환경 변수
- [app/](app/) — Android·iOS용 Flutter 앱
- [모바일 실행 안내](app/README.md) — Android Studio와 시뮬레이터 설정
- [pling-app.html](pling-app.html) — 디자인 원본
- [HANDOFF.md](HANDOFF.md) — 디자인 요구사항과 변경 이력

로컬 비밀값, 사용자 DB, 빌드 결과는 저장소에 넣지 않습니다.
