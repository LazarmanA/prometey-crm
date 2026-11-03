#!/usr/bin/env bash
# ПРОМЕТЕЙ CRM — установка прямо на сервере (из консоли хостинга), без SSH с компьютера:
#   curl -sLo i.sh https://raw.githubusercontent.com/LazarmanA/prometey-crm/main/deploy/i.sh && bash i.sh
set -e
cd /root
echo "Скачиваю ПРОМЕТЕЙ…"
curl -fsSL -o prometey.tgz https://codeload.github.com/LazarmanA/prometey-crm/tar.gz/refs/heads/main
curl -fsSL -o install-server.sh https://raw.githubusercontent.com/LazarmanA/prometey-crm/main/deploy/install-server.sh
exec bash install-server.sh --archive /root/prometey.tgz
