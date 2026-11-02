@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (
 echo.
 echo Ошибка установки. Проверьте сообщения выше.
 pause
 exit /b 1
)
pause
