# 플잉 작업 안내

2026년 11월 19일 로컬 작업본. 이 폴더에서 바로 소스를 편집할 수 있다.

- 최신 디자인은 루트의 `pling-app.html`이다. 설문 안내, 칠각형 차트, 유형별 캐릭터와 상위 3개 카드, 달력, 유리 탭 바를 여기서 확인한다.
- `docs/공부유형-분류기준.md`에 20개 유형의 가중치, 산식과 발표용 예시가 있다.
- Flutter 앱은 `app/`, NestJS·PostgreSQL 서버는 `backend/`에 있다. 설치 및 실행 방법은 각 README를 참고한다.
- HTML은 독립형 디자인 프로토타입이다. 최신 설문과 디자인을 모바일에 반영할 때에는 HTML과 Flutter·서버 구현의 차이를 확인한다.
- 서버 구조와 검증 상태는 `docs/ARCHITECTURE.md`와 `docs/IMPLEMENTATION_STATUS.md`, 과거 결정 기록은 `HANDOFF.md`를 참고한다.
- 원격 저장소는 https://github.com/sawreze/Plan-ing.git 이며 원본의 작업 브랜치는 `codex/backend`다. 커밋 전 변경분은 현재 폴더의 소스에 포함돼 있다. Git 이력은 `Plan-ing.bundle`에 보관했다.

## 맥 실행 스크립트 (mac-dev/, Finder에서 더블클릭)

- `1-git-복원.command` — `Plan-ing.bundle`에서 Git 이력을 복원하고 `codex/backend` 브랜치로 맞춘다. 작업 폴더 파일은 그대로 둔다.
- `2-HTML-미리보기.command` — http://localhost:5500/pling-app.html 로 디자인 원본을 띄운다.
- `3-백엔드-실행.command` — Docker(colima)·PostgreSQL을 켜고 `backend/run-local.sh`로 서버(:8080)를 실행한다.
- `4-iOS-시뮬레이터.command` — 백엔드 확인 후 iOS 시뮬레이터에서 `flutter run`을 실행한다.
- 원본과 동일했던 `app/ios/Runner 2.*` 중복 사본은 `_to_delete/ios-duplicates/`로 옮겼다.
