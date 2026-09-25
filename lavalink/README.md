# Lavalink — запуск на host PC (музыка уровня Jockie)

Почему: Jockie написан на Java и едет на Lavalink (их открытые репо — Java-инфра,
включая форк TLS-библиотеки conscrypt: они борются с детектом на уровне TLS).
Повторить их TLS-патчи в Node нереально, а вот вынести звук в Lavalink — да:
весь фетч/транскод уезжает в Java-процесс, бот только управляет.

## Что нужно на host PC (Windows)
- Java 17+: https://adoptium.net/ → Temurin 17 JRE, установщик `.msi`
  (проверка: `java -version` в новом окне PowerShell)
- Node.js 20+ для самого бота (уже стоит, раз бот едет)

## Запуск (Windows)
1. Скачай `Lavalink.jar` в эту папку:
   https://github.com/lavalink-devs/Lavalink/releases (бери v4, файл `Lavalink.jar`)
2. В `application.yml`:
   - смени `lavalink.server.password` и продублируй в `.env` бота (`LAVALINK_PASSWORD`)
   - вставь Spotify ключи в секцию `plugins.lavasrc.spotify`
   - сверь версии плагинов с их GitHub-релизами
3. Первый запуск руками для проверки (из PowerShell в папке `lavalink\`):
   ```powershell
   java -jar Lavalink.jar
   ```
   Жди строку про успешный старт и порт 2333 (ошибок по плагинам быть не должно).
4. Автозапуск: Планировщик заданий → `java.exe` с аргументом
   `-jar "C:\путь\к\lavalink\Lavalink.jar"`, рабочая папка — папка `lavalink\`,
   триггер при запуске системы. Либо `.bat` в автозагрузку:
   ```bat
   @echo off
   cd /d C:\HPSB\lavalink
   java -jar Lavalink.jar
   ```
5. В `.env` бота: `MUSIC_ENGINE=lavalink`, `LAVALINK_HOST=127.0.0.1`,
   `LAVALINK_PORT=2333`, `LAVALINK_PASSWORD=...`
6. Код движка (`src/modules/music/engine-lavalink.js`) уже готов, команды
   мигрируют со звуковыми тестами на месте.

## Что это даст
- YouTube/Spotify/Apple/Deezer/SoundCloud/Bandcamp/HTTP — все провайдеры из одного места
- Spotify по ISRC — точные совпадения вместо «похожего»
- Плейлисты, поиск `ytsearch:`/`scsearch:`, очередь и фильтры — как у Jockie
- Бот переживает рестарт Lavalink (переподключение), звук не зависит от сети бота
