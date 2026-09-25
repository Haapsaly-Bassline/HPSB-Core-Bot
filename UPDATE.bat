@echo off
REM HPSB Core Bot - обновление кода на host PC (после копирования свежих файлов)
REM Копировать: src\, lavalink\, package.json, *.md, .env.example
REM НЕ трогать: node_modules\, .env, data\store.json
cd /d %~dp0
echo === Stop old bot (PM2 or close its window manually) ===
call pm2 stop hpsb 2>nul
echo === Install new deps ===
call npm install || (echo [FAIL] npm install & pause & exit /b 1)
REM На старом npm (<11) команды install-scripts нет — там скрипты и так разрешены
call npm install-scripts approve @discordjs/opus ffmpeg-static >nul 2>&1
call npm rebuild @discordjs/opus ffmpeg-static 2>nul
echo === Register commands ===
call npm run register || (echo [FAIL] register & pause & exit /b 1)
echo === Start ===
call pm2 restart hpsb 2>nul || (start "hpsb" npm start)
echo.
echo === DONE. Check /version in Discord (must be 0.2.0+) ===
pause
