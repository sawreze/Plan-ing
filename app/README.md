# 플잉 앱 (Flutter · iOS/Android)

하나의 Dart 코드로 iPhone과 Android를 함께 만든다. 서버는 `../backend`(Spring Boot).

## 실행

1. 서버: `../backend/run-local.sh`
2. iOS 시뮬레이터: `open -a Simulator` 후 `flutter run -d "iPhone 17 Pro"`
3. 안드로이드 에뮬레이터: Android Studio의 Device Manager에서 에뮬레이터를 켠 뒤 `flutter run -d emulator-5554`

서버 주소는 자동으로 iOS `localhost:8080`, Android `10.0.2.2:8080`. 실기기는 `flutter run --dart-define=API_URL=http://<맥 IP>:8080`.
안드로이드의 http 허용은 디버그 빌드에만 있다(`android/app/src/debug/AndroidManifest.xml`). 릴리스는 HTTPS 서버가 필요하다.

`build/`는 iCloud 밖 `~/Library/Caches/pling-app-build`를 가리키는 링크다. 데스크톱(iCloud) 안에서 빌드하면 iOS 코드서명이 실패한다.
앱 아이콘(1번)을 바꿨으면 `dart run flutter_launcher_icons`.

## 화면

- 로그인: 1번 아이콘, 앱 이름 플잉, ADHD 문구, 닉네임 테스트 로그인(실제 Google/Apple 아님을 화면에 표시)
- 계획: 날짜 이동, 목록(색 띠), 완료 체크, 탭하면 집중 시작/완료/삭제, 계획 만들기(기본 5개 파스텔 + 직접 조색, 25/50/90분)
- 집중: 오늘 진행 중이거나 다음 계획을 **준비만** 한다. 가운데 ▶를 눌러야 시작, 이후 ✓. 멈춤/재개/넘기기. 앱으로 돌아오면 서버 시간으로 다시 맞춤. 완료 시 마스코트 축하 + 코인 5개 받기
- 목표: 추가·완료·삭제
- 설정: 코인 잔액, 앱 안 테마(시스템/라이트/다크, 서버에 저장), 알림 선호(저장만)

## 아직 없는 것

가운데 탭 Gemini 채팅, 월·주 달력 보기(일 단위 목록만), 설문 화면, 크루, 실제 푸시 알림, 캐릭터 표정 계산, 실제 소셜 로그인.
