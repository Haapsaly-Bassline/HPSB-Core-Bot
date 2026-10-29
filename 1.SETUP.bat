@echo off
REM HPSB Music Bot - first-time install on the bot host (double-click)
cd /d %~dp0
echo === Node ===
node --version || (echo [FAIL] Node.js 20+ from https://nodejs.org & pause & exit /b 1)
echo === Install ===
call npm install || (echo [FAIL] npm install & pause & exit /b 1)
echo === Register commands ===
call npm run register || (echo [FAIL] register - check .env DISCORD_TOKEN/GUILD_ID & pause & exit /b 1)
echo.
echo === DONE. Start: npm start ===
pause
