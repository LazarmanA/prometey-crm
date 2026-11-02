@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 24 LTS с https://nodejs.org/
  pause
  exit /b 1
)
echo Запуск ПРОМЕТЕЙ CRM...
start "" http://localhost:3030
node --disable-warning=ExperimentalWarning server.js
pause
