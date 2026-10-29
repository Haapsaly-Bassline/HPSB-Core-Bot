@echo off
REM HPSB Music Bot - update code on the bot host
REM Copy: src\, package.json, *.md, .env.example
REM Do NOT touch: node_modules\, .env
cd /d %~dp0
echo === Stop old bot (PM2 or close its window manually) ===
call pm2 stop hpsb-music 2>nul
echo === Install new deps ===
call npm install || (echo [FAIL] npm install & pause & exit /b 1)
echo === Register commands ===
call npm run register || (echo [FAIL] register & pause & exit /b 1)
echo === Start ===
call pm2 restart hpsb-music 2>nul || (start "hpsb-music" npm start)
echo.
echo === DONE. Check /version in Discord ===
pause
