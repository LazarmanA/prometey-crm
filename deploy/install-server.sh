#!/usr/bin/env bash
# =====================================================================
#  ПРОМЕТЕЙ CRM — автоматическая установка/обновление на сервер
#  Ubuntu 22.04 / 24.04. Запускать от root.
#
#  Обычно запускается сам из deploy.bat (Windows). Вручную:
#     bash install-server.sh                      # спросит всё сам
#     bash install-server.sh --domain crm.site.ru --email me@mail.ru
#     bash install-server.sh --auto --data /root/prometey-data.tgz   # без вопросов (так запускает deploy.bat)
#
#  Что делает:
#   1) обновляет систему, включает брандмауэр и защиту от подбора паролей
#   2) ставит Node.js 24, nginx, sqlite3 (и по желанию LibreOffice для PDF)
#   3) распаковывает программу в /opt/prometey (данные при обновлении не трогает)
#   4) создаёт службу, которая запускается сама после перезагрузки
#   5) настраивает nginx и бесплатный HTTPS-сертификат
#   6) включает ежедневный бэкап в 03:30 (хранится 30 дней)
#   7) ставит команду  prometey  (статус, логи, перезапуск, бэкап)
# =====================================================================
set -Eeuo pipefail

APP_DIR=/opt/prometey
DATA_DIR=/var/lib/prometey
BACKUP_DIR=/var/backups/prometey
ENV_FILE=/etc/prometey.env
CONF_FILE=/etc/prometey.conf
SERVICE=prometey
APP_USER=prometey
DEFAULT_PORT=3000

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ARCHIVE="${ARCHIVE:-}"
WITH_PDF="${WITH_PDF:-}"     # yes / no
AUTO="${AUTO:-no}"           # yes — ни одного вопроса: вход в CRM — данные с компьютера или регистрация по ссылке
DATA_ARCHIVE="${DATA_ARCHIVE:-}"  # данные CRM с компьютера (база + файлы) — только при первой установке

c_ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
c_info() { printf '\033[1;36m➜ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
c_err()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; }
step()   { printf '\n\033[1;35m━━━ %s ━━━\033[0m\n' "$*"; }
trap 'c_err "Ошибка в строке $LINENO. Сделайте снимок экрана с текстом выше и пришлите его — разберёмся."' ERR

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)  DOMAIN="$2"; shift 2 ;;
    --email)   EMAIL="$2"; shift 2 ;;
    --archive) ARCHIVE="$2"; shift 2 ;;
    --pdf)     WITH_PDF=yes; shift ;;
    --no-pdf)  WITH_PDF=no; shift ;;
    --auto)    AUTO=yes; shift ;;
    --data)    DATA_ARCHIVE="$2"; shift 2 ;;
    *) c_err "Неизвестный параметр: $1"; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { c_err "Запустите от root (или через sudo)."; exit 1; }
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || c_warn "Скрипт проверялся для Ubuntu, у вас: ${PRETTY_NAME:-неизвестно}."

# ---------- архив с программой ----------
if [[ -z "$ARCHIVE" ]]; then
  for f in /root/prometey.tgz /root/prometey.tar.gz /root/prometey.zip; do
    [[ -f "$f" ]] && { ARCHIVE="$f"; break; }
  done
fi
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { c_err "Не найден архив программы (/root/prometey.tgz). Загрузите его на сервер."; exit 1; }

UPDATE=no
[[ -f "$APP_DIR/package.json" ]] && UPDATE=yes
if [[ -f "$CONF_FILE" ]]; then   # домен/почта с прошлой установки (если не заданы сейчас)
  ARG_DOMAIN="$DOMAIN"; ARG_EMAIL="$EMAIL"; . "$CONF_FILE"
  DOMAIN="${ARG_DOMAIN:-$DOMAIN}"; EMAIL="${ARG_EMAIL:-$EMAIL}"
fi

ask() { # ask "вопрос" "значение по умолчанию" -> REPLY
  local q="$1" d="${2:-}"
  if [[ -t 0 ]]; then read -r -p "$q${d:+ [$d]}: " REPLY || true; fi
  REPLY="${REPLY:-$d}"
}

[[ "$AUTO" == "yes" ]] && WITH_PDF="${WITH_PDF:-yes}"
if [[ "$UPDATE" == "no" && "$AUTO" != "yes" ]]; then
  step "Пара вопросов"
  if [[ -z "$DOMAIN" ]]; then
    echo "Введите адрес сайта для CRM (например crm.mycompany.ru)."
    echo "Если домена пока нет — просто нажмите Enter (будет работать по IP, без HTTPS)."
    ask "Домен" ""; DOMAIN="$REPLY"
  fi
  if [[ -n "$DOMAIN" && -z "$EMAIL" ]]; then
    ask "Ваш e-mail (туда придёт письмо, если сертификат HTTPS не продлится)" ""; EMAIL="$REPLY"
  fi
  if [[ -z "$WITH_PDF" ]]; then
    ask "Ставить LibreOffice для красивых PDF по шаблонам Word? (займёт ~500 МБ) y/n" "y"
    [[ "$REPLY" =~ ^[YyДд] ]] && WITH_PDF=yes || WITH_PDF=no
  fi
fi
DOMAIN="${DOMAIN,,}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

export DEBIAN_FRONTEND=noninteractive
# Ubuntu 24.04: needrestart после обновления сам перезапускает службы, в том числе вход SSH — посреди установки.
# Только список, без перезапусков.
export NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1

# =====================================================================
step "1/7  Обновление системы и защита"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q curl ca-certificates gnupg ufw fail2ban nginx sqlite3 unzip tar rsync unattended-upgrades
timedatectl set-timezone Europe/Moscow 2>/dev/null || true

# подкачка, если памяти мало (нужно для LibreOffice и обновлений)
MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [[ $MEM_MB -lt 2500 ]] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  c_ok "Добавлен файл подкачки 2 ГБ"
fi

# брандмауэр: сначала разрешаем SSH на том порту, где он реально работает
# порт текущего подключения + порты из настроек sshd (в Ubuntu 24.04 порт слушает systemd, а не sshd)
SSH_PORTS=$( { echo "${SSH_CONNECTION:-} " | awk '{print $4}'; sshd -T 2>/dev/null | awk '/^port /{print $2}'; ss -ltnpH 2>/dev/null | awk '/sshd/{n=split($4,a,":"); print a[n]}'; } | grep -E '^[0-9]+$' | sort -u)
[[ -z "$SSH_PORTS" ]] && SSH_PORTS=22
for p in $SSH_PORTS; do ufw allow "$p/tcp" >/dev/null; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
mkdir -p /etc/fail2ban/jail.d
# защита от подбора паролей; компьютер, с которого ставят CRM (адрес из текущего подключения), не блокируется никогда
ADMIN_IP=$(echo "${SSH_CONNECTION:-}" | awk '{print $1}')
printf '[sshd]\nenabled = true\nport = %s\nmaxretry = 10\nfindtime = 10m\nbantime = 15m\nignoreip = 127.0.0.1/8 ::1 %s\n' "$(echo $SSH_PORTS | tr ' ' ',')" "$ADMIN_IP" > /etc/fail2ban/jail.d/prometey-sshd.conf
systemctl enable --now fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban >/dev/null 2>&1 || true
c_ok "Брандмауэр включён: открыты только SSH ($SSH_PORTS), 80 и 443"

# =====================================================================
step "2/7  Node.js 24"
need_node=yes
if command -v node >/dev/null 2>&1; then
  node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' && need_node=no
fi
if [[ $need_node == yes ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -q nodejs
fi
c_ok "Node.js $(node -v)"

if [[ "$WITH_PDF" == "yes" ]] && ! command -v soffice >/dev/null 2>&1; then
  c_info "Ставлю LibreOffice (несколько минут)…"
  apt-get install -y -q --no-install-recommends libreoffice-writer fonts-dejavu fonts-liberation
  c_ok "LibreOffice установлен"
fi
# Счета и договоры с подписью и печатью точнее всего печатает браузер (как в предпросмотре).
if [[ "$WITH_PDF" == "yes" ]] && ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  c_info "Ставлю Google Chrome для печати документов…"
  if curl -fsSL --max-time 180 -o /tmp/prometey-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
     && apt-get install -y -q /tmp/prometey-chrome.deb >/dev/null; then c_ok "Google Chrome установлен"
  else c_warn "Chrome не скачался — документы будут печататься через LibreOffice (печать встанет рядом с подписью)"; fi
  rm -f /tmp/prometey-chrome.deb
fi

# =====================================================================
step "3/7  Программа"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR/assets" "$DATA_DIR/documents" "$DATA_DIR/recordings" "$BACKUP_DIR"
chmod 750 "$DATA_DIR"
chmod 750 "$BACKUP_DIR"

TMP=$(mktemp -d)
case "$ARCHIVE" in
  *.zip) unzip -q "$ARCHIVE" -d "$TMP/src" ;;
  *)     mkdir -p "$TMP/src" && tar -xzf "$ARCHIVE" -C "$TMP/src" ;;
esac
SRC=$(dirname "$(find "$TMP/src" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | awk '{print length, $0}' | sort -n | head -1 | cut -d' ' -f2-)")
[[ -f "$SRC/package.json" ]] || { c_err "В архиве нет package.json — это точно папка Прометея?"; exit 1; }

if [[ "$UPDATE" == "yes" ]]; then
  c_info "Найдена установленная версия — делаю бэкап и обновляю (данные сохраняются)"
  /usr/local/bin/prometey-backup >/dev/null 2>&1 || true
  systemctl stop "$SERVICE" 2>/dev/null || true
fi
# копируем код; базы данных и файлы из архива НЕ перезаписывают рабочие
rsync -a \
  --exclude 'node_modules/' --exclude '.git/' \
  --exclude '*.db' --exclude '*.db-wal' --exclude '*.db-shm' --exclude '*.db-journal' \
  --exclude '*.sqlite' --exclude '*.sqlite3' --exclude '*.sqlite-*' \
  --exclude '.env' --exclude 'deploy/' --exclude 'runtime/' --exclude 'installer/' --exclude '*.exe' \
  "$SRC/" "$APP_DIR/"
rm -rf "$TMP"

# зависимости (у Прометея их нет, но если появятся — поставятся)
if node -e 'const p=require(process.argv[1]);process.exit(Object.keys(p.dependencies||{}).length?0:1)' "$APP_DIR/package.json"; then
  ( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund )
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

# точка входа: npm start -> "main" -> server.js / index.js / app.js
ENTRY=$(node -e '
  const p=require(process.argv[1]); const s=(p.scripts&&p.scripts.start)||"";
  const m=s.match(/node\s+(?:--[\w-]+(?:=\S+)?\s+)*([^\s&|;]+\.m?js)/);
  console.log(m?m[1]:(p.main||""));' "$APP_DIR/package.json")
if [[ -z "$ENTRY" || ! -f "$APP_DIR/$ENTRY" ]]; then
  for f in server.js index.js app.js src/server.js; do [[ -f "$APP_DIR/$f" ]] && { ENTRY="$f"; break; }; done
fi
[[ -n "$ENTRY" && -f "$APP_DIR/$ENTRY" ]] || { c_err "Не нашёл файл запуска сервера (server.js)."; exit 1; }
c_ok "Файл запуска: $ENTRY"

# данные CRM с компьютера (из deploy.bat): только на новый сервер, рабочую базу сервера не трогаем никогда
if [[ -n "$DATA_ARCHIVE" && -f "$DATA_ARCHIVE" ]]; then
  if [[ "$UPDATE" == "no" && ! -f "$DATA_DIR/prometey.sqlite" ]]; then
    DT=$(mktemp -d); tar -xzf "$DATA_ARCHIVE" -C "$DT"
    if [[ -f "$DT/prometey.sqlite" ]] && head -c 15 "$DT/prometey.sqlite" | grep -q 'SQLite format'; then
      install -m 600 "$DT/prometey.sqlite" "$DATA_DIR/prometey.sqlite"
      for d in documents recordings uploads; do [[ -d "$DT/$d" ]] && { mkdir -p "$DATA_DIR/$d"; cp -a "$DT/$d/." "$DATA_DIR/$d/"; }; done
      chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
      c_ok "Данные CRM с компьютера перенесены: сотрудники входят прежними логинами и паролями"
    else
      c_warn "Архив данных повреждён — CRM установлена с чистой базой"
    fi
    rm -rf "$DT"
  else
    c_info "На сервере уже есть данные — архив с компьютера не применяется (данные сервера сохранены)"
  fi
  rm -f "$DATA_ARCHIVE"
fi

# =====================================================================
step "4/7  Служба (автозапуск)"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
# Настройки Прометея. После правки:  systemctl restart prometey
NODE_ENV=production
HOST=127.0.0.1
PORT=$DEFAULT_PORT
TRUST_PROXY=1
COOKIE_SECURE=auto
SESSION_TTL_HOURS=12
DB_FILE=$DATA_DIR/prometey.sqlite
DOCUMENTS_DIR=$DATA_DIR/documents
RECORDINGS_DIR=$DATA_DIR/recordings
ASSETS_DIR=$DATA_DIR/assets
TZ=Europe/Moscow
EOF
fi
# обновление со старых версий: недостающие настройки безопасности
grep -q '^TRUST_PROXY=' "$ENV_FILE" || echo 'TRUST_PROXY=1' >> "$ENV_FILE"
if ! grep -q '^DB_FILE=' "$ENV_FILE" && [[ ! -f "$APP_DIR/storage/prometey.sqlite" ]]; then
  printf 'DB_FILE=%s\nDOCUMENTS_DIR=%s\nRECORDINGS_DIR=%s\n' "$DATA_DIR/prometey.sqlite" "$DATA_DIR/documents" "$DATA_DIR/recordings" >> "$ENV_FILE"
fi
if [[ -n "$DOMAIN" ]]; then
  sed -i '/^PUBLIC_URL=/d;/^BASE_URL=/d' "$ENV_FILE"
  printf 'PUBLIC_URL=https://%s\nBASE_URL=https://%s\n' "$DOMAIN" "$DOMAIN" >> "$ENV_FILE"
fi
chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"

# рабочий режим не запустится с демо-паролями: логины и пароли задаются до первого старта
# без вопросов: учётные записи берутся из перенесённой базы, а если её нет — руководитель регистрируется по одноразовой ссылке
if [[ "$AUTO" == "yes" ]] && ! grep -q '^PROMETEY_ADMIN_PASSWORD=' "$ENV_FILE" && ! grep -q '^PROMETEY_SETUP=1' "$ENV_FILE"; then
  printf 'PROMETEY_SETUP=1\nPROMETEY_SETUP_TOKEN=%s\n' "$(head -c 18 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')" >> "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
fi
if ! grep -q '^PROMETEY_SETUP=1' "$ENV_FILE" && { ! grep -q '^PROMETEY_ADMIN_PASSWORD=' "$ENV_FILE" || ! grep -q '^PROMETEY_MANAGER_PASSWORD=' "$ENV_FILE"; }; then
  step "Пароли руководителя и менеджера"
  echo "Придумайте НАДЁЖНЫЕ пароли (от 12 символов) и сразу запишите их."
  echo "При вводе пароля символы на экране не видны — это нормально."
  if [[ -t 0 ]]; then
    node "$APP_DIR/scripts/set-credentials.js" "$ENV_FILE" || { c_err "Пароли не заданы. Запустите установку ещё раз."; exit 1; }
    chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
    c_ok "Пароли сохранены"
  else
    c_err "Нужен ввод с клавиатуры. Подключитесь: ssh -t root@сервер и выполните: node $APP_DIR/scripts/set-credentials.js $ENV_FILE"
    exit 1
  fi
fi

cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Prometey CRM
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=HOME=$DATA_DIR
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning $ENTRY
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR $APP_DIR/storage
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# ждём, пока программа откроет порт, и узнаём, какой именно
PORT=""
for _ in $(seq 1 40); do
  PID=$(systemctl show -p MainPID --value "$SERVICE")
  if [[ -n "$PID" && "$PID" != "0" ]]; then
    PORTS=$(ss -ltnpH 2>/dev/null | grep "pid=$PID," | awk '{n=split($4,a,":"); print a[n]}' | sort -un || true)
    if [[ -n "$PORTS" ]]; then
      PORT=$(echo "$PORTS" | grep -x "$DEFAULT_PORT" || echo "$PORTS" | head -1)
      break
    fi
  fi
  sleep 0.5
done
if [[ -z "$PORT" ]]; then
  c_err "Программа не запустилась. Последние строки журнала:"
  journalctl -u "$SERVICE" -n 40 --no-pager
  exit 1
fi
c_ok "Прометей работает (внутренний порт $PORT)"

# проверка состояния программы
HEALTH=$(curl -s --max-time 10 "http://127.0.0.1:$PORT/api/health" || true)
if [[ "$HEALTH" == *'"ok":true'* ]]; then c_ok "Проверка /api/health пройдена"
elif [[ "$HEALTH" == *'"pdfReady":false'* ]]; then c_warn "CRM работает, но PDF-документы не формируются: нет LibreOffice. Установите: apt-get install -y libreoffice-writer fonts-dejavu fonts-liberation && prometey restart"
else c_warn "Проверка /api/health: ${HEALTH:-нет ответа}"; fi

# =====================================================================
step "5/7  Nginx (вход из интернета)"
SERVER_NAME="${DOMAIN:-_}"
# ограничение частоты: вход — 10 попыток в минуту с адреса, остальное API — с запасом
cat > /etc/nginx/conf.d/prometey-limits.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=prometey_login:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=prometey_api:10m rate=20r/s;
limit_conn_zone $binary_remote_addr zone=prometey_conn:10m;
limit_req_status 429;
limit_conn_status 429;
EOF
cat > /etc/nginx/sites-available/prometey <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    client_max_body_size 900m;    # архив переноса данных; лимиты отдельных загрузок проверяет сама CRM
    server_tokens off;
    client_body_timeout 30s;
    client_header_timeout 15s;
    send_timeout 60s;
    limit_conn prometey_conn 50;

    # служебные и скрытые файлы не отдаём никогда
    location ~ /\.(?!well-known) { return 404; }

    location = /api/login {
        limit_req zone=prometey_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
    }

    location /api/ {
        limit_req zone=prometey_api burst=60 nodelay;
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/prometey /etc/nginx/sites-enabled/prometey
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || { nginx -t; exit 1; }
systemctl enable nginx >/dev/null 2>&1
systemctl reload nginx || systemctl restart nginx
c_ok "Nginx настроен"

# =====================================================================
step "6/7  HTTPS"
MY_IP=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
HTTPS=no
if [[ -n "$DOMAIN" ]]; then
  apt-get install -y -q certbot python3-certbot-nginx >/dev/null
  DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
  if [[ "$DNS_IP" != "$MY_IP" ]]; then
    c_warn "Домен $DOMAIN пока указывает на '${DNS_IP:-никуда}', а сервер — $MY_IP."
    c_warn "Проверьте A-запись у регистратора. Когда заработает, выполните:  prometey https"
  else
    if [[ -n "$EMAIL" ]]; then M=(-m "$EMAIL"); else M=(--register-unsafely-without-email); fi
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${M[@]}"; then
      HTTPS=yes; c_ok "HTTPS включён, сертификат продлевается сам"
    else
      c_warn "Сертификат не получен. Повторите позже:  prometey https"
    fi
  fi
else
  c_warn "Домен не указан — работа без HTTPS. Это годится только для пробы."
fi

# =====================================================================
step "7/7  Бэкапы и команда prometey"
cat > /usr/local/bin/prometey-backup <<'EOF'
#!/usr/bin/env bash
# Ежедневная копия: все базы SQLite (безопасно, на ходу) + программа + файлы
set -euo pipefail
DIR=/var/backups/prometey; STAMP=$(date +%F_%H%M); OUT="$DIR/$STAMP"
mkdir -p "$OUT/db"
i=0
while IFS= read -r -d '' f; do
  if head -c 15 "$f" 2>/dev/null | grep -q 'SQLite format'; then
    i=$((i+1)); sqlite3 "$f" ".backup '$OUT/db/$i-$(basename "$f")'"
    echo "$f" >> "$OUT/db/files.txt"
  fi
done < <(find /opt/prometey /var/lib/prometey -type f \( -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' \) -not -path '*/node_modules/*' -print0)
umask 077
tar czf "$OUT/files.tgz" --exclude='node_modules' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.sqlite' --exclude='*.sqlite-*' \
    -C / opt/prometey var/lib/prometey etc/prometey.env 2>/dev/null || true
tar czf "$DIR/prometey-$STAMP.tgz" -C "$DIR" "$STAMP" && rm -rf "$OUT"
find "$DIR" -name 'prometey-*.tgz' -mtime +30 -delete
echo "$DIR/prometey-$STAMP.tgz"
EOF
chmod 750 /usr/local/bin/prometey-backup
echo "30 3 * * * root /usr/local/bin/prometey-backup >/dev/null 2>&1" > /etc/cron.d/prometey-backup

cat > /usr/local/bin/prometey <<'EOF'
#!/usr/bin/env bash
# Простые команды для управления Прометеем
. /etc/prometey.conf 2>/dev/null || true
case "${1:-help}" in
  status)    systemctl status prometey --no-pager -l | head -15 ;;
  logs)      journalctl -u prometey -n "${2:-100}" --no-pager ;;
  live)      journalctl -u prometey -f ;;
  restart)   systemctl restart prometey && echo "Перезапущено" ;;
  stop)      systemctl stop prometey && echo "Остановлено" ;;
  start)     systemctl start prometey && echo "Запущено" ;;
  backup)    /usr/local/bin/prometey-backup ;;
  backups)   ls -lh /var/backups/prometey ;;
  passwords) node /opt/prometey/scripts/set-credentials.js /etc/prometey.env && chown root:prometey /etc/prometey.env && chmod 640 /etc/prometey.env && systemctl restart prometey && echo "Пароли изменены, все старые входы закрыты" ;;
  https)     [[ -n "${DOMAIN:-}" ]] || { echo "Домен не задан. Запустите установку заново с --domain"; exit 1; }
             if [[ -n "${EMAIL:-}" ]]; then M=(-m "$EMAIL"); else M=(--register-unsafely-without-email); fi
             certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${M[@]}" ;;
  settings)  nano /etc/prometey.env && systemctl restart prometey ;;
  *) cat <<H
Команды:
  prometey status     — работает ли CRM
  prometey logs       — последние 100 строк журнала (prometey logs 500 — больше)
  prometey live       — журнал в реальном времени (выход: Ctrl+C)
  prometey restart    — перезапустить CRM
  prometey backup     — сделать бэкап прямо сейчас
  prometey backups    — список бэкапов
  prometey passwords  — сменить пароли руководителя/менеджера
  prometey https      — (повторно) получить HTTPS-сертификат
  prometey settings   — открыть файл настроек
H
  ;;
esac
EOF
chmod 755 /usr/local/bin/prometey

cat > "$CONF_FILE" <<EOF
DOMAIN="$DOMAIN"
EMAIL="$EMAIL"
EOF

/usr/local/bin/prometey-backup >/dev/null 2>&1 && c_ok "Первый бэкап сделан, дальше — каждую ночь в 03:30"

# проверка, что сайт отвечает через nginx
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN:-localhost}" http://127.0.0.1/ || true)
[[ "$CODE" =~ ^(2|3|401) ]] && c_ok "Сайт отвечает (код $CODE)" || c_warn "Сайт ответил кодом $CODE — посмотрите: prometey logs"

if [[ "$HTTPS" == "yes" ]]; then URL="https://$DOMAIN"
elif [[ -n "$DOMAIN" ]]; then URL="http://$DOMAIN  (HTTPS включите позже: prometey https)"
else URL="http://$MY_IP"; fi

# адрес для открытия: если CRM ждёт первую регистрацию — одноразовая ссылка с ключом
BASE_URL_OPEN="http://$MY_IP"; [[ "$HTTPS" == "yes" ]] && BASE_URL_OPEN="https://$DOMAIN"; [[ "$HTTPS" != "yes" && -n "$DOMAIN" ]] && BASE_URL_OPEN="http://$DOMAIN"
LINK="$BASE_URL_OPEN/"
if curl -s --max-time 10 "http://127.0.0.1:$PORT/api/setup" | grep -q '"needed":true'; then
  TOKEN=$(grep '^PROMETEY_SETUP_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  [[ -n "$TOKEN" ]] && LINK="$BASE_URL_OPEN/#setup=$TOKEN"
fi
umask 077; echo "$LINK" > /root/prometey-link.txt

printf '\n\033[1;32m══════════════════════════════════════════════════════\033[0m\n'
if [[ "$UPDATE" == "yes" ]]; then echo "  ✅ Прометей ОБНОВЛЁН. Данные сохранены."
else echo "  ✅ Прометей УСТАНОВЛЕН."; fi
echo   "  Адрес CRM:  $URL"
[[ "$LINK" == *"#setup="* ]] && echo "  Создать учётную запись руководителя: $LINK"
echo   "  Управление: команда  prometey  (на сервере)"
printf '\033[1;32m══════════════════════════════════════════════════════\033[0m\n'
