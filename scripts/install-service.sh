#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "错误: 本脚本仅支持 Linux 系统 (systemd)"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "错误: 请使用 sudo 运行此脚本"
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="allpush-api"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ACTUAL_USER="${SUDO_USER:-$USER}"

cat > "$SERVICE_FILE" << SERVICE_EOF
[Unit]
Description=AllPush API Platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${ACTUAL_USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=$(which node) --env-file=.env apps/api/dist/index.js
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE_EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo "服务 ${SERVICE_NAME} 已安装并启动"
echo "状态: systemctl status ${SERVICE_NAME}"
echo "日志: journalctl -u ${SERVICE_NAME} -f"
