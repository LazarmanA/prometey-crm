#!/usr/bin/env bash
# ПРОМЕТЕЙ · Пульт продавца — установка на сервер Ubuntu 22.04/24.04 одной командой:
#
#   sudo bash install-vendor.sh pult.example.ru you@example.ru
#
# Что делает: Node.js 24, nginx, бесплатный HTTPS (Let's Encrypt), служба systemd с песочницей,
# ежедневная резервная копия данных пульта (14 дней). В конце печатает логин и пароль, адрес пульта
# и команду сборки установщика CRM с подключением к пульту.
set -euo pipefail
DOMAIN=${1:-}; ADMIN_EMAIL=${2:-}
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$ADMIN_EMAIL" ] || { echo "Использование: sudo bash install-vendor.sh ДОМЕН EMAIL"; exit 1; }
SRC=$(cd "$(dirname "$0")/.." && pwd)
APP=/opt/prometey-vendor; DATA=/var/lib/prometey-vendor; ENVF=/etc/prometey-vendor.env; USER_=prometey-vendor; PORT=8090
export DEBIAN_FRONTEND=noninteractive
echo "== пакеты"
apt-get update -q >/dev/null
apt-get install -y -q curl ca-certificates gnupg nginx ufw >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
echo "   Node.js $(node -v)"
echo "== файлы"
id "$USER_" >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin "$USER_"
mkdir -p "$APP" "$DATA" "$DATA/backups"
cp -r "$SRC/server.js" "$SRC/package.json" "$SRC/public" "$APP/"
chown -R root:root "$APP"; chown -R "$USER_:$USER_" "$DATA"; chmod 700 "$DATA"
PASSWORD=""
if [ ! -f "$ENVF" ]; then
  PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)-$(date +%Y)
  umask 077
  cat > "$ENVF" <<EOF
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=$DATA
TRUST_PROXY=1
VENDOR_ADMIN_EMAIL=$ADMIN_EMAIL
VENDOR_ADMIN_PASSWORD=$PASSWORD
EOF
  chmod 600 "$ENVF"
fi
echo "== служба"
cat > /etc/systemd/system/prometey-vendor.service <<EOF
[Unit]
Description=ПРОМЕТЕЙ · Пульт продавца
After=network-online.target
[Service]
User=$USER_
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning $APP/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=$DATA
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload; systemctl enable --now prometey-vendor >/dev/null 2>&1; systemctl restart prometey-vendor
echo "== nginx"
cat > /etc/nginx/sites-available/prometey-vendor <<EOF
limit_req_zone \$binary_remote_addr zone=pv_login:10m rate=10r/m;
server {
  listen 80; server_name $DOMAIN;
  client_max_body_size 1m;
  location = /api/login { limit_req zone=pv_login burst=5 nodelay; proxy_pass http://127.0.0.1:$PORT; include /etc/nginx/proxy_params; proxy_set_header X-Forwarded-Proto \$scheme; }
  location / { proxy_pass http://127.0.0.1:$PORT; include /etc/nginx/proxy_params; proxy_set_header X-Forwarded-Proto \$scheme; }
}
EOF
ln -sf /etc/nginx/sites-available/prometey-vendor /etc/nginx/sites-enabled/prometey-vendor
nginx -t >/dev/null && systemctl reload nginx
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null
echo "== HTTPS"
apt-get install -y -q certbot python3-certbot-nginx >/dev/null
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect -m "$ADMIN_EMAIL" || echo "!! HTTPS не получен: проверьте, что домен $DOMAIN указывает на этот сервер, и запустите: certbot --nginx -d $DOMAIN"
echo "== резервные копии"
cat > /etc/cron.daily/prometey-vendor-backup <<EOF
#!/bin/sh
D=$DATA/backups/\$(date +%F); mkdir -p "\$D"
sqlite3 "$DATA/vendor.sqlite" ".backup '\$D/vendor.sqlite'" 2>/dev/null || cp "$DATA/vendor.sqlite" "\$D/"
cp "$DATA/license-signing-key.pem" "\$D/"; chown -R $USER_:$USER_ "\$D"; chmod -R go-rwx "\$D"
find $DATA/backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
chmod 755 /etc/cron.daily/prometey-vendor-backup; apt-get install -y -q sqlite3 >/dev/null || true
for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORT/api/v1/health" >/dev/null && break; sleep 1; done
KEY=$(curl -fs "http://127.0.0.1:$PORT/api/v1/public-key" | node -pe 'JSON.parse(require("fs").readFileSync(0)).publicKey')
echo
echo "================ Пульт продавца готов ================"
echo "Адрес:   https://$DOMAIN"
echo "Логин:   $ADMIN_EMAIL"
[ -n "$PASSWORD" ] && echo "Пароль:  $PASSWORD   (смените в пульте: «Сменить пароль»)"
echo
echo "Сборка установщика CRM с подключением к пульту:"
echo "  LICENSE_SERVER=https://$DOMAIN LICENSE_KEY=$KEY NODE_EXE=/путь/node.exe CRM=../crm ./build.sh"
echo
echo "ВАЖНО: сохраните копию $DATA/license-signing-key.pem — без неё нельзя будет подписывать подписки."
