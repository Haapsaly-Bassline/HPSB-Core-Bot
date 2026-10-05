# Moving bot to host PC on Windows (migration)

The bot is fully Windows-native: relative paths, FFmpeg/Opus with win32 binaries,
Lavalink — jar for any OS. Nothing needs rewriting.

## 0. First check host PC network — this is critical
Current PC blocks Discord voice UDP and half of media (YouTube/IG/SC).
If host PC is on the same network — same issue. 2-minute check:

1. Move bot folder, `npm install`, write `.env`, run `npm start`.
2. Join a regular voice channel, run `/play` with a radio URL or `/perms` to check voice connectivity.
3. Check verdict:
   - `Connection: ready` + packets + audible → network OK, proceed;
   - `signalling` + abort → UDP blocked here too, fix network/hosting, not the bot.

## 1. File transfer
Copy to host PC **entire `HPSB Core Bot` folder, EXCEPT**:
- `node_modules/` (will be reinstalled)
- `.env` (create fresh from `.env.example`, fill secrets manually!)

`data/store.json` copy — contains reposter/warn/ticket memory.

## 2. Installation (Windows)
1. Node.js LTS 20+ from nodejs.org (`node --version`).
2. In bot folder: `npm install`.
3. If asked about install-scripts: `npm install-scripts approve @discordjs/opus ffmpeg-static`, then `npm rebuild`.
4. Create `.env` from `.env.example`, fill `DISCORD_TOKEN` and others.
5. Enable intents in Developer Portal (Server Members + Message Content) — tied to app, not PC, should already be on.
6. `npm run register` (once), then `npm start`.

## 3. Auto-start (survive reboot)
Option A — PM2 (recommended):
```powershell
npm i -g pm2 pm2-windows-startup
pm2 start src/index.js --name hpsb
pm2 save
pm2-startup install   # once, from PowerShell as admin
```
Post-reboot check: `pm2 list` → hpsb online. Logs: `pm2 logs hpsb` (also `data/bot.log`).

Option B — Windows Task Scheduler (no PM2):
- Action: start program `C:\Program Files\nodejs\node.exe`
- Arguments: `src/index.js`, working dir: bot path
- Trigger: at user logon (or at system startup + autologon)
- "Run with highest privileges" not needed, but set
  "restart on failure" in task settings.

## 4. Music on host PC (test order)
1. `/radio` — direct mp3, no external APIs. Played = voice works.
2. `/play` Bandcamp link (custom resolver), then Spotify, then SoundCloud.
3. YouTube — depends (if host PC network not blocking, youtubei picks up).
4. Lavalink stage (see `lavalink/README.md`): Java 17 + `Lavalink.jar` nearby,
    `MUSIC_ENGINE=lavalink` in `.env`, command migration — with sound tests in place.

## 6. Updating code on host PC (important!)
I tweak the bot here — after each update, push fresh code:
1. Stop bot there (`pm2 stop hpsb` or close window).
2. Copy from this PC **code only**: folders `src/`, `lavalink/`, files
   `package.json`, `README.md`, `MIGRATION.md`, `.env.example`.
   DO NOT TOUCH there: `node_modules/`, `.env`, `data/store.json`.
3. There: `npm install` (pulls new) → `npm run register` → run.
4. Version check: `/version` in Discord — match number with `package.json` here.
   If old number — running old code, update again.

## 7. What NOT to copy/do
- Don't run two bot copies at once (old PC + host PC) — duplicate replies
  and voice fights. Stopped here → started there.
- Tokens and cookies (`DISCORD_TOKEN`, `IG_SESSIONID`) — manual in `.env` only, never in chats.
- Don't run two bot copies at once (old PC + host PC) — duplicate replies
  and voice fights. Stopped here → started there.
- Tokens and cookies (`DISCORD_TOKEN`, `IG_SESSIONID`) — manual in `.env` only, never in chats.