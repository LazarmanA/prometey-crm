@echo off
chcp 65001 >nul
cd /d %~dp0
node --disable-warning=ExperimentalWarning scripts\run-all-tests.js --no-browser
pause
