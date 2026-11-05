#!/usr/bin/env bash
# Сборка установщика: упаковывает CRM в app.zip и собирает PrometeyCRM-Setup-<версия>.exe (Windows x64)
# и prometey-setup-linux (для автоматической проверки установщика на Linux).
set -euo pipefail
cd "$(dirname "$0")"
CRM=${CRM:-../crm}
VERSION=$(node -p "require('$CRM/package.json').version")
rm -f app.zip
( cd "$CRM" && zip -qr -X "$OLDPWD/app.zip" . \
   -x '.git/*' 'node_modules/*' 'tests/*' 'backups/*' 'storage/*.sqlite*' 'storage/documents/*' 'storage/recordings/*' \
      '*.log' 'recording.png' 'TEST_WINDOWS.bat' 'START_MAC.command' 'install-windows.ps1' 'УСТАНОВИТЬ_И_ЗАПУСТИТЬ.cmd' \
      'RESET_DEMO_WINDOWS.bat' 'START_WINDOWS.bat' 'Dockerfile' 'docker-compose.yml' '.dockerignore' '.env' '.env.*' )
echo "app.zip: $(du -h app.zip | cut -f1), версия $VERSION"
mkdir -p dist
# Node.js для Windows вшивается в установщик: NODE_EXE=путь/к/node.exe (официальная сборка, подпись OpenJS Foundation).
# Без NODE_EXE установщик скачает Node.js с nodejs.org во время установки.
rm -f node.zip
NODE_SHA=""
if [[ -n "${NODE_EXE:-}" ]]; then
  T=$(mktemp -d); cp "$NODE_EXE" "$T/node.exe"; [[ -f "$(dirname "$NODE_EXE")/LICENSE" ]] && cp "$(dirname "$NODE_EXE")/LICENSE" "$T/LICENSE"
  ( cd "$T" && zip -q -9 -X "$OLDPWD/node.zip" node.exe $( [[ -f LICENSE ]] && echo LICENSE ) )
  NODE_SHA=$(sha256sum "$T/node.exe" | cut -d' ' -f1); rm -rf "$T"
  echo "node.zip: $(du -h node.zip | cut -f1), node.exe sha256 $NODE_SHA"
else
  : > node.zip
fi
python3 tools/mkres.py "$VERSION" .   # иконка и сведения о версии → rsrc_windows_amd64.syso
go vet ./...
GOOS=windows GOARCH=amd64 go vet ./...
# Пульт продавца: адрес и открытый ключ (см. «Пульт → Настройки»). Без них CRM работает без подписки.
LICENSE_SERVER=${LICENSE_SERVER:-}; LICENSE_KEY=${LICENSE_KEY:-}
if [ -n "$LICENSE_SERVER" ]; then echo "подписка: $LICENSE_SERVER"; else echo "подписка: не подключена (LICENSE_SERVER не задан)"; fi
LDF="-s -w -X main.Version=$VERSION -X main.nodeExeSHA256=$NODE_SHA -X main.licenseServer=$LICENSE_SERVER -X main.licenseKey=$LICENSE_KEY"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$LDF -H windowsgui" -o "dist/PrometeyCRM-Setup-$VERSION.exe" .
CGO_ENABLED=0 go build -trimpath -ldflags "$LDF" -o dist/prometey-setup-linux .
ls -la dist
