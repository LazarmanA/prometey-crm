@echo off
rem PROMETEY: update server and register the owner again (data kept)
call "%~dp0deploy\deploy.bat" -NewOwner
if errorlevel 1 pause
