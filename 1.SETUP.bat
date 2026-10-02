@echo off
REM HPSB Core Bot - первичная установка на host PC (запуск двойным кликом)
cd /d %~dp0
echo === Node ===
node --version || (echo [FAIL] Node.js 20+ with https://nodejs.org & pause & exit /b 1)
echo === Install ===
call npm install || (echo [FAIL] npm install & pause & exit /b 1)
echo === Native voice deps ===
REM На старом npm (<11) команды install-scripts нет — там скрипты и так разрешены
call npm install-scripts approve @discordjs/opus ffmpeg-static >nul 2>&1
call npm rebuild @discordjs/opus ffmpeg-static
echo === Register commands ===
call npm run register || (echo [FAIL] register - check .env DISCORD_TOKEN/GUILD_ID & pause & exit /b 1)
echo.
echo === DONE. Start: npm start ===
pause
