@echo off
rem Chat Studio launcher (started by the "ChatStudio" scheduled task). Keep this file ASCII-only.
setlocal EnableExtensions
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DATA_DIR=%ROOT%\data"
set "PORT=8420"
if exist "%ROOT%\settings.env" (
  for /f "usebackq eol=# tokens=1* delims==" %%a in ("%ROOT%\settings.env") do set "%%a=%%b"
)
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%ROOT%\logs\app.log" type nul > "%ROOT%\logs\app.log"
:loop
for %%F in ("%ROOT%\logs\app.log") do if %%~zF GTR 10000000 move /y "%ROOT%\logs\app.log" "%ROOT%\logs\app.old.log" >nul
echo [%date% %time%] starting >> "%ROOT%\logs\app.log"
"%ROOT%\current\node.exe" "%ROOT%\current\server\src\index.js" >> "%ROOT%\logs\app.log" 2>&1
echo [%date% %time%] stopped (exit code %errorlevel%), restart in 5 s >> "%ROOT%\logs\app.log"
ping -n 6 127.0.0.1 >nul
goto loop
