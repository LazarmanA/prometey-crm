#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node.js 18+ с https://nodejs.org/"
  read -p "Enter для выхода"
  exit 1
fi
(open http://localhost:3030 >/dev/null 2>&1 &) || true
node server.js
