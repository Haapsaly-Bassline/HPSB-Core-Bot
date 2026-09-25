# Переезд бота на host PC (миграция)

## 0. Сначала проверь сеть host PC — это критично
Текущий ПК режет голосовой UDP Discord и половину медиа (YouTube/IG/SC).
Если host PC в той же сети — будет то же самое. Проверка за 2 минуты:

1. Перенеси папку бота, `npm install`, впиши `.env`, запусти `npm start`.
2. Зайди в обычный войс, выполни `/voice-debug`.
3. Смотри вердикт:
   - `Connection: ready` + пакеты + слышно → сеть годится, едем дальше;
   - `signalling` + abort → UDP режут и тут, чини сеть/хостинг, а не бота.

## 1. Перенос файлов
Скопируй на host PC **всю папку `HPSB Core Bot`, КРОМЕ**:
- `node_modules/` (поставится заново)
- `.env` (создай заново из `.env.example`, секреты впиши руками!)

`data/store.json` скопируй — там память репостеров/варнов/тикетов.

## 2. Установка (Windows)
1. Node.js LTS 20+ с nodejs.org (`node --version`).
2. В папке бота: `npm install`.
3. Если спросит про install-scripts: `npm install-scripts approve @discordjs/opus ffmpeg-static`, затем `npm rebuild`.
4. Создай `.env` из `.env.example`, впиши `DISCORD_TOKEN` и остальные.
5. Включи intents в Developer Portal (Server Members + Message Content) — они привязаны к приложению, а не к ПК, уже должны быть.
6. `npm run register` (один раз), затем `npm start`.

## 3. Автозапуск (чтобы жил после перезагрузки)
Вариант PM2:
```powershell
npm i -g pm2
pm2 start src/index.js --name hpsb
pm2 save
pm2-startup install  # выполнить выданную команду с правами админа
```
Логи: `pm2 logs hpsb`. В Discord те же логи через `/logs`.

## 4. Музыка на host PC (порядок тестов)
1. `/radio` — прямой mp3, без внешних API. Заиграло = голос в порядке.
2. `/play` Bandcamp-ссылка (свой резолвер), затем Spotify, затем SoundCloud.
3. YouTube — по ситуации (если сеть host PC не режут, youtubei подхватит).
4. Этап Lavalink (см. `lavalink/README.md`): Java 17 + `Lavalink.jar` рядом,
   `MUSIC_ENGINE=lavalik` в `.env`, миграция команд — со звуковыми тестами на месте.

## 5. Что НЕ переносить/не делать
- Не запускай две копии бота одновременно (старый ПК + host PC) — будут дубли ответов
  и драки за войс. Остановил тут → запустил там.
- Токены и куки (`DISCORD_TOKEN`, `IG_SESSIONID`) — только руками в `.env`, ни в какие чаты.
