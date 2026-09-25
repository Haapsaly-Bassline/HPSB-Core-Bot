# Lavalink — запуск на VPS (музыка уровня Jockie)

Почему: Jockie написан на Java и едет на Lavalink (их открытые репо — Java-инфра,
включая форк TLS-библиотеки conscrypt: они борются с детектом на уровне TLS).
Повторить их TLS-патчи в Node нереально, а вот вынести звук в Lavalink — да:
весь фетч/транскод уезжает в Java-процесс, бот только управляет.

## Что нужно на VPS
- Ubuntu 22.04+, 1 CPU / 1 GB RAM минимум
- Java 17+: `sudo apt install -y openjdk-17-jre-headless`
- Node.js 20+ для самого бота

## Запуск
1. Скачай `Lavalink.jar` в эту папку:
   https://github.com/lavalink-devs/Lavalink/releases (бери v4, файл `Lavalink.jar`)
2. В `application.yml`:
   - смени `lavalink.server.password` и продублируй в `.env` бота (`LAVALINK_PASSWORD`)
   - вставь Spotify ключи в секцию `plugins.lavasrc.spotify`
   - сверь версии плагинов с их GitHub-релизами
3. Запуск: `java -jar Lavalink.jar` (в проде — через systemd, юнит ниже)
4. В `.env` бота: `MUSIC_ENGINE=lavalink`, `LAVALINK_HOST=127.0.0.1`,
   `LAVALINK_PORT=2333`, `LAVALINK_PASSWORD=...`
5. Код движка (`src/modules/music/engine-lavalink.js`) подключается на этом этапе —
   сейчас бот осознанно едет на discord-player, чтобы ничего не сломать без VPS для тестов.

## systemd-юнит (пример)
```ini
[Unit]
Description=HPSB Lavalink
After=network.target

[Service]
WorkingDirectory=/opt/hpsb/lavalink
ExecStart=/usr/bin/java -jar Lavalink.jar
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Что это даст
- YouTube/Spotify/Apple/Deezer/SoundCloud/Bandcamp/HTTP — все провайдеры из одного места
- Spotify по ISRC — точные совпадения вместо «похожего»
- Плейлисты, поиск `ytsearch:`/`scsearch:`, очередь и фильтры — как у Jockie
- Бот переживает рестарт Lavalink (переподключение), звук не зависит от сети бота
