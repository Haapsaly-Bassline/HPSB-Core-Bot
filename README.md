# HPSB Core Bot — Haapsaly Bassline

Многофункциональный бот: музыка в духе Jockie + радио + репостеры + свои новости + honeypot + ModCall + логи.
Весь код написан с нуля под HPSB (по мотивам Jockie/Carl, без копирования чужого кода).

## Команды (19)
- Музыка: `/play` (YT/SP/SC/прямые mp3/плейлисты) `/radio` (HPSB/Predictor/свой поток) `/skip` `/stop` `/queue` `/nowplaying` `/loop` `/shuffle` `/remove` `/move` `/seek` `/volume` `/clear` `/pause` `/resume`
- Модерация: `/modcall-panel` `/publish` `/logs` `/reposter-status`
- YouTube идёт через `discord-player-youtubei` (стабильнее скрапинга). Bandcamp/Audiomack — только прямые audio-ссылки или зеркала YT/SC.

## Модули
- `reposter` — YouTube (Data API ключ → RSS → скрап), TikTok (TikWM), Instagram (Graph → скрап профиля → RSSHub; нужна `IG_SESSIONID`).
- `site-publisher` — релизы/события/посты HPSB: JSON первичен, RSS фолбэк. Первый запуск только запоминает.
- `honeypot` — публичная ловушка (первое сообщение = мут 12ч/kick/ban, настраивается) + красный варнинг при старте + скам-фильтр + анти масс-пинг. Владелец и моды не задеваются.
- `modcall` — кнопка → модалка → тикет в staff-канал (тред) + двусторонний релей через ЛС, включая вложения.
- `webhook` — `POST :3001/hook/news` от своих сервисов (нужен `WEBHOOK_NEWS_CHANNEL_ID` + секрет).

## Запуск
1. Скопируй `.env.example` → `.env`, заполни (все ID уже вписаны, нужен только `DISCORD_TOKEN`).
2. Developer Portal → Bot: включи **Server Members Intent** и **Message Content Intent**.
3. `npm install` (если ругнётся на install-scripts — `npm install-scripts approve @discordjs/opus ffmpeg-static` + `npm rebuild`).
4. `npm run register` — slash-команды на гильдию.
5. `npm start` (фон: через PM2/планировщик; логи — `data/bot.log`, смотреть через `/logs`).

Права бота: Administrator (или: Manage Channels/Threads, Timeout Members, Connect/Speak, Send Messages/Embeds, Read History).

## Свои сервисы → Discord
POST `http://host:3001/hook/news`, header `x-hpsb-secret` или поле `secret`:
```json
{ "secret": "...", "title": "New drop", "description": "...", "url": "https://...", "image": "https://..." }
```
