#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run setup:local
docker compose up -d --wait db
npm run build
npm run migrate
exec npm start
