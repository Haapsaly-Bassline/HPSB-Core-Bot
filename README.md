# HPSB Core Bot — Haapsaly Bassline

Multipurpose Discord bot: Lavalink music engine (Jockie-style) + HPSB radio + reposters + site news + honeypot/automod + ModCall tickets + stats + webhooks. Written from scratch for HPSB (inspired by Jockie/Carl, no copied code).

## Features
- **Music (Lavalink-only):** `/play` (text / links / playlists / direct mp3 / Bandcamp fan profile + `count`), `/radio` (HPSB stations + custom streams), `/queue`, `/nowplaying` (live ticking embed with buttons), `/skip [count]`, `/join`, `/loop`, `/shuffle`, `/remove`, `/move`, `/seek`, `/volume`, `/clear`, `/pause` (toggle), `/stop`, `/onair` (radio station metadata).
  Sources: YouTube (plugin + OAuth + yt-dlp cookies fallback), SoundCloud, Bandcamp, Vimeo, Deezer/Apple/Tidal/Qobuz (via LavaSrc, need tokens), HTTP radio/files. Spotify is OFF until the Spotify app gets Premium.
- **Stage speaker:** the bot auto-requests speaker on Stage channels (unsuppress REST + request fallback, re-asks if suppressed).
- **Reposter:** YouTube / TikTok / Instagram → Discord media posts.
- **Site publisher:** HPSB releases / events / posts feeds + webhook receiver.
- **Automod & honeypot:** flood/caps/links/invites/badwords, trap channel, anti-raid.
- **ModCall:** button → modal → staff ticket thread with two-way DM relay.
- **Stats:** Member-Count-style voice counters (`/counters setup`).
- **Ops:** `/health` self-check, `/logs`, `/version`.

## Requirements
- Node.js 20+, Java 17+ (for Lavalink), a Discord app with bot token.
- Dev Portal → Bot: enable **Server Members Intent**, **Message Content Intent**, **Presence Intent** (last one is for online/offline counters).
- Bot permissions: Administrator (or Manage Channels/Threads, Timeout Members, Connect/Speak, Send Messages/Embeds, Read History).

## Quickstart
1. `cp .env.example .env` and fill it (Discord token, guild/channel/role IDs).
2. Lavalink (see `lavalink/README.md` for details):
   - download `Lavalink.jar` v4 into `lavalink/`;
   - `cp lavalink/application.example.yml lavalink/application.yml` and fill passwords/tokens;
   - keep `LAVALINK_PASSWORD` in sync between `application.yml` and bot `.env`.
3. `npm install` (if it complains about install-scripts: approve `opencode` + `ffmpeg-static`, then `npm rebuild`).
4. `npm run register` — guild slash commands.
5. Start Lavalink: `java "-Djava.net.preferIPv4Stack=true" -jar Lavalink.jar` (quotes matter on PowerShell), wait for `ready to accept connections`.
6. `npm start` (background: PM2 / scheduler; logs in `data/bot.log`, also via `/logs`).

## Project layout
- `src/commands/` — slash commands (41).
- `src/events/` — `ready` (engine init, pollers), `interactionCreate`, `voiceStateUpdate`, moderation events.
- `src/modules/music/` — `engine-lavalink.js` (queue/voice), `service.js` (single entry), `resolvers.js` (query routing), `np.js` (live Now Playing), `stage.js` (speaker), `bandcamp-fan.js` (fan collections).
- `src/modules/` — `reposter`, `site-publisher`, `honeypot`, `modcall`, `stats`, `private` (voice rooms), `automod` (see code).
- `src/utils/` — embeds (unified overlays), music fmt, selfcheck, logger, store.
- `lavalink/` — `application.example.yml` (template), `README.md` (sources matrix, tokens, OAuth, yt-dlp cookies), plugins auto-download on first run.

## Secrets discipline
Never committed (all gitignored): `.env`, `lavalink/application.yml`, `lavalink/cookies.txt`, `lavalink/*.jar`, `data/*.json`. Templates with `PASTE_*` placeholders are committed instead. After every `git pull`, re-fill local secrets and restart Lavalink + bot.
