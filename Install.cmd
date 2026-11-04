@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "install_result=%ERRORLEVEL%"
if not "%install_result%"=="0" echo Installation did not complete. Read the message above before retrying.
pause
exit /b %install_result%
