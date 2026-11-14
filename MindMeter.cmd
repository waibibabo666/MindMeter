@echo off
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%CD%\code"
python -m desktop.launcher %*
if errorlevel 1 (
  echo.
  echo MindMeter failed to start. See %%LOCALAPPDATA%%\MindMeter\logs\launcher.log
  pause
)
endlocal
