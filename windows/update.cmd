@echo off
rem Update wrapper: first applies a refreshed update.ps1 (if the previous run left one), then runs it.
if exist "%~dp0update.ps1.new" move /y "%~dp0update.ps1.new" "%~dp0update.ps1" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
