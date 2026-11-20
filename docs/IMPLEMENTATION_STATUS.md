# 구현 상태 · 2026-11-19

새 작업 브랜치는 codex/backend입니다. 기존 backend 브랜치의 Spring Boot 서버는 변경하지 않았습니다. 서버는 아키텍처 초안에 맞춰 NestJS·PostgreSQL로 새로 작성했습니다. 모바일 플랫폼 골격은 기존 Flutter 앱을 가져와 인증과 기능을 수정했습니다.

## 구현

- 이메일 계정·scrypt 비밀번호 해시·HS256 JWT. Supabase 모드의 외부 issuer/JWKS 토큰 검증 경계.
- 사용자 타임존 일정 CRUD·낙관적 버전·DB 범위 충돌 제약.
- READY부터 시작하는 집중 세션, 서버 시간 복원과 계획별 5코인 원장.
- 목표·설문 사분면 저장, 크루 멤버·초대코드·탈퇴·크루장 권한.
- 서버 Gemini 호출·구조화된 변경 제안·확인 후 적용·대화 조회/삭제.
- 기기 등록, 트랜잭션 예약·취소·APNs 워커·잠금 만료·재시도.
- Flutter 이메일 로그인, 서버 기능 화면 연결, Android/iOS 주소 설정.

## 검증

- TypeScript 빌드.
- PostgreSQL WASM 엔진 PGlite 서비스 통합 11개 항목 + Nest 모듈 구성 1개 통과.
- Flutter Dart 정적 분석: No issues found.
- 실제 PostgreSQL 서버는 공유 메모리, HTTP 수신은 포트 권한 제한으로 실행하지 못함.
- SDK·ADB·CoreSimulator 권한으로 실제 모바일 빌드/에뮬레이터 실행 미검증.
- Gemini·APNs 테스트는 대역 사용. 사용자 키로 외부 호출하지 않음.

## 미완료

외부 Google/Apple 로그인 모바일 흐름, 실제 공급자 JWKS 검증, HTTP·실제 PostgreSQL 다중 연결 E2E, 실제 Gemini·APNs, Android FCM, 네이티브 권한/토큰, 출시 서명·배포, HTML 달력 전체의 Flutter 포팅. 조기 수동 완료에도 5코인을 주는 현재 제품 정책은 유지했다.

도구 권한 범위가 누적되어 Git 명령까지 자동 승인 검토에 거부된 상태다. Git 커밋·푸시는 아직 수행되지 않았다. 다음 권한 범위가 정리된 실행에서 변경을 확인·커밋·푸시해야 한다. 기존 backend 브랜치를 덮어쓰거나 강제 푸시하지 않는다.
