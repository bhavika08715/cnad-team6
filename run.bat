@echo off
REM One-click start for Windows
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies ^(one time, about 10 seconds^)...
  call npm install --no-audit --no-fund
)
echo Starting FoodBridge at http://localhost:3000
start "" http://localhost:3000
node server.js
pause
