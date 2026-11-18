#!/bin/bash
# 로컬·에뮬레이터 확인용 서버 실행. http://localhost:8080 (테스트 화면), 안드로이드 에뮬레이터는 10.0.2.2:8080
set -e
cd "$(dirname "$0")"
# 맥 기본 Java가 1.8이면 Android Studio에 들어 있는 Java(17+)를 쓴다.
if ! java -version 2>&1 | grep -qE 'version "(1[7-9]|2[0-9])'; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
export AUTH_DEV_SECRET="${AUTH_DEV_SECRET:-local-dev-secret-change-me-0123456789}"  # 로컬 전용. 운영 금지
./mvnw -q -DskipTests package
exec "${JAVA_HOME:+$JAVA_HOME/bin/}java" -jar target/pling-backend-0.0.1-SNAPSHOT.jar
