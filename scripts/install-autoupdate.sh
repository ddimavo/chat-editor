#!/usr/bin/env bash
# Включает автообновление: systemd-таймер раз в 2 минуты запускает scripts/auto-update.sh.
# Использование:  sudo ./scripts/install-autoupdate.sh        (отключить:  sudo ./scripts/install-autoupdate.sh --remove)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo."; exit 1; }
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "--remove" ]; then
  systemctl disable --now chat-editor-update.timer 2>/dev/null || true
  rm -f /etc/systemd/system/chat-editor-update.{service,timer}; systemctl daemon-reload; echo "Автообновление выключено."; exit 0
fi
chmod +x "$DIR/scripts/auto-update.sh"
cat > /etc/systemd/system/chat-editor-update.service <<UNIT
[Unit]
Description=Chat Studio: проверка и установка новой версии
After=docker.service network-online.target
[Service]
Type=oneshot
ExecStart=$DIR/scripts/auto-update.sh
UNIT
cat > /etc/systemd/system/chat-editor-update.timer <<UNIT
[Unit]
Description=Chat Studio: автообновление каждые 2 минуты
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now chat-editor-update.timer
echo "Готово. Журнал обновлений:  journalctl -u chat-editor-update -n 30"
