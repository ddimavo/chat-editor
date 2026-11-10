#!/usr/bin/env bash
# Согласованная резервная копия базы прямо сейчас + копирование файла на сервер (в ./backups).
# Использование:  ./scripts/backup.sh      (для cron: 0 4 * * * /путь/к/chat-editor/scripts/backup.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
FILE=$(docker compose exec -T app node server/src/cli.js backup | sed -n 's/^Резервная копия: //p' | tr -d '\r')
docker cp "chat-editor:${FILE}" "backups/$(basename "$FILE")"
# храним локально только последние 14 копий
ls -1t backups/chat-editor-*.sqlite 2>/dev/null | tail -n +15 | xargs -r rm -f --
echo "Готово: backups/$(basename "$FILE")"
