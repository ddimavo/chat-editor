@echo off
rem Admin CLI:  cli.cmd users | create <login> [password] | passwd <login> [password] | delete <login> | backup
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DATA_DIR=%ROOT%\data"
"%ROOT%\current\node.exe" "%ROOT%\current\server\src\cli.js" %*
