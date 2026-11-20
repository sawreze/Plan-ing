#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v flutter >/dev/null || { echo "Flutter SDK를 먼저 설치해주세요."; exit 1; }
flutter pub get
if [[ "${1:-android}" == "ios" ]]; then
  flutter run --dart-define=API_URL=http://localhost:8080
else
  echo "Android Studio > Device Manager에서 에뮬레이터를 켠 다음 장치 목록에서 Android를 선택해주세요."
  flutter run --dart-define=API_URL=http://10.0.2.2:8080
fi
