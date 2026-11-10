#!/usr/bin/env bash
# Установка Chat Studio на чистый Ubuntu-сервер БЕЗ клонирования исходников:
#   curl -fsSL https://raw.githubusercontent.com/ddimavo/chat-editor/main/scripts/install.sh | sudo bash
# Скачивает только docker-compose.yml, .env и скрипты в /opt/chat-editor, запускает приложение и включает автообновление.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo."; exit 1; }
REPO="${REPO:-ddimavo/chat-editor}"; BRANCH="${BRANCH:-main}"; DIR="${DIR:-/opt/chat-editor}"
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"

command -v docker >/dev/null || { echo "Ставлю Docker…"; curl -fsSL https://get.docker.com | sh; }
mkdir -p "$DIR/scripts"; cd "$DIR"
for f in docker-compose.yml Caddyfile .env.example scripts/auto-update.sh scripts/install-autoupdate.sh scripts/backup.sh; do
  curl -fsSL "$RAW/$f" -o "$f"
done
chmod +x scripts/*.sh
[ -f .env ] || { cp .env.example .env; echo "Создан $DIR/.env — при необходимости поправьте (порт, код регистрации, HTTPS)."; }

if ! docker compose pull app; then
  echo
  echo "Не удалось скачать образ. Вероятно, пакет в GitHub ещё приватный. Сделайте его публичным:"
  echo "  GitHub → ваш профиль → Packages → chat-editor → Package settings → Change visibility → Public"
  echo "(или войдите:  docker login ghcr.io -u ВАШ_ЛОГИН  — токен с правом read:packages). Затем запустите этот скрипт снова."
  exit 1
fi
docker compose up -d app
./scripts/install-autoupdate.sh
echo
echo "Готово. Приложение: http://IP_СЕРВЕРА:$(grep -E '^HOST_PORT=' .env | cut -d= -f2 | head -1 || echo 8420)"
