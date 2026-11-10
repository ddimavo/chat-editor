#!/usr/bin/env bash
# Обновление до последней версии из git и перезапуск (данные в томе сохраняются).
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
