@echo off
setlocal

set "ROOT=%~dp0.."
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LOG_DIR=%ROOT%\logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

cd /d "%ROOT%"
"%NODE_EXE%" bin\teleton-code.js start --no-open 1> "%LOG_DIR%\service.stdout.log" 2> "%LOG_DIR%\service.stderr.log"
