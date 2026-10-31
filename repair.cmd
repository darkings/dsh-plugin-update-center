@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
set "HARNESS=%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe"
if exist "%HARNESS%" (
  "%HARNESS%" "%~dp0repair.mjs" %*
) else (
  node "%~dp0repair.mjs" %*
)
