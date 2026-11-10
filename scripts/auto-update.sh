#!/usr/bin/env bash
# Подтягивает свежий образ из ghcr.io и перезапускает приложение, только если образ изменился.
# Если новая версия не стала «healthy» — откатывается на предыдущую и запоминает «плохой» образ, чтобы не повторять попытки.
# Запускается по таймеру (scripts/install-autoupdate.sh) или вручную:  ./scripts/auto-update.sh
set -uo pipefail
cd "$(dirname "$0")/.."
IMAGE="${APP_IMAGE:-ghcr.io/ddimavo/chat-editor:latest}"
[ -f .env ] && APP_IMAGE_ENV=$(grep -E '^APP_IMAGE=' .env | tail -1 | cut -d= -f2-) && [ -n "${APP_IMAGE_ENV:-}" ] && IMAGE="$APP_IMAGE_ENV"
export APP_IMAGE="$IMAGE"
BAD_FILE=".bad-image"
log() { echo "[$(date '+%F %T')] $*"; }

old=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)
if ! docker compose pull -q app >/dev/null 2>&1; then log "не удалось скачать образ (нет сети или нужен docker login ghcr.io) — пропускаю"; exit 0; fi
new=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)

if [ -n "$new" ] && [ "$new" = "$old" ] && docker ps --format '{{.Names}}' | grep -qx chat-editor; then exit 0; fi   # обновлений нет
if [ -f "$BAD_FILE" ] && [ "$(cat "$BAD_FILE")" = "$new" ]; then exit 0; fi                                        # эта версия уже не взлетела

log "найдена новая версия, обновляю…"
docker compose up -d --remove-orphans app

for _ in $(seq 1 30); do
  st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' chat-editor 2>/dev/null || echo missing)
  [ "$st" = healthy ] || [ "$st" = running ] && { log "готово: приложение работает ($st)"; docker image prune -f >/dev/null 2>&1; exit 0; }
  sleep 4
done

log "ОШИБКА: новая версия не запустилась (статус: $st)."
if [ -n "$old" ] && [ "$old" != "$new" ]; then
  echo "$new" > "$BAD_FILE"
  docker tag "$old" "$IMAGE" && docker compose up -d --no-build app && log "откатился на предыдущую версию"
fi
exit 1
