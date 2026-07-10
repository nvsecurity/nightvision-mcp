#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/fixtures/demo-apps/express-api"

echo "Starting NightVision Express API fixture from $APP_DIR"
cd "$APP_DIR"
npm install
PORT="${PORT:-9000}" npm run dev
