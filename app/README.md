# 플잉 모바일 앱

Flutter로 Android와 iOS에서 같은 서버에 연결합니다. 서버 코드는 ../backend에 있습니다.

## Android Studio

1. Flutter·Dart 플러그인을 설치하고 Flutter SDK 경로를 지정합니다.
2. Android Studio에서 이 app 폴더를 엽니다.
3. Device Manager에서 Android 에뮬레이터를 켭니다. 이 맥에서 확인된 AVD 이름은 Medium_Phone_API_37.0입니다.
4. 맥 터미널에서 backend/run-local.sh로 서버를 켭니다.
5. app 폴더에서 flutter pub get을 실행하고 Flutter 장치 선택에서 에뮬레이터를 고릅니다.

```sh
flutter run --dart-define=API_URL=http://10.0.2.2:8080
```

Android 에뮬레이터에서 10.0.2.2는 맥의 localhost입니다. http 허용은 debug 매니페스트에만 있으며 출시 빌드는 HTTPS 서버와 별도 서명 설정이 필요합니다.

## iOS 시뮬레이터

Xcode와 시뮬레이터가 설치된 맥에서 장치를 켠 뒤 실행합니다.

```sh
flutter run --dart-define=API_URL=http://localhost:8080
```

실기기는 서버에 도달할 수 있는 HTTPS 주소를 API_URL로 지정해야 합니다. localhost와 10.0.2.2는 실기기용 주소가 아닙니다.

## 기능

이메일 가입·로그인, 계획 목록·추가·완료·삭제, 서버 기반 집중 타이머와 보상, 목표·크루, 공부 유형 설문, AI 대화·일정 변경 제안, 테마·알림 설정을 연결했습니다.

토큰은 앱 메모리에만 보관하므로 앱을 종료하면 다시 로그인합니다. 계정의 데이터와 코인은 서버에 남습니다. Gemini 키가 없으면 연결 오류를 표시하며 가짜 답변은 만들지 않습니다.

기존 Flutter 화면 골격을 가져와 새 NestJS API에 맞게 인증과 기능 연결을 수정했습니다. 디자인 원본은 저장소 루트의 pling-app.html입니다. 현재 모바일 화면은 모든 HTML 화면의 완전한 포팅이 아닙니다. 일·주·월 팔레트 달력 전체, 소셜 로그인, 푸시 권한·토큰 등록, 크루 관리의 모든 동작은 후속 작업입니다.

## 확인한 것과 남은 것

Dart 정적 분석은 오류 없이 통과했습니다. 이 작업 환경에서는 SDK 캐시 쓰기·ADB·CoreSimulator 권한이 허용되지 않아 APK/iOS 빌드나 실제 에뮬레이터 실행은 확인하지 못했습니다. 실행됐다고 가정하지 않고, 위 명령으로 실제 장치에서 검증해야 합니다.
