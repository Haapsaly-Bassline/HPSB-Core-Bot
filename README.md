# HPSB Core Bot — Haapsaly Bassline

Multipurpose Discord bot: Lavalink music engine (Jockie-style) + unified
Publisher (YouTube / Twitch / Instagram / TikTok / HPSB feeds) + honeypot/automod
+ ModCall tickets + stats + private rooms + webhooks. Written from scratch for
HPSB (inspired by Jockie/Carl, no copied code).

## Architecture

```text
                       HPSB CORE BOT
                             │
                     ┌───────▼───────┐
                     │ MODULE MANAGER│  src/modules/manager.js
                     └───────┬───────┘  startAll() in ready.js
                             │
        ┌────────────┬───────┼────────┬────────────┐
        ▼            ▼       ▼        ▼            ▼
      Music      Publisher  AutoMod  ModCall     Stats ...
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
       Sources   Webhooks   Pollers
          │
    ┌─────┼─────┬─────┬─────┬─────┐
    ▼     ▼     ▼     ▼     ▼     ▼
   YT   Twitch  IG    TT   HPSB  Live
    │     │      │     │     │     │
    └─────┴──────┴─────┴─────┴─────┘
                    │
                 NORMALIZE
                    │
                  DEDUP  (survives restart, data/store.json)
                    │
                  QUEUE  (serial, in-memory)
                    │
                  ROUTER
                    │
              ┌─────┴─────┐
              ▼           ▼
        #announcements  #media

#partners = manual only (/partner-post), Publisher never writes there
```

### Module Manager

Every subsystem is a manifest (`name, label, dependsOn, start, stop`) managed from
`src/modules/manager.js`. `ready.js` calls `startAll()` — no manual per-module
boots. One failing module never takes down the rest; repeated starts are no-ops
(no duplicate timers).

| Module | What it runs |
|---|---|---|
| `music` | Lavalink engine init (+ retry until node connects) |
| `publisher` | Pipeline + scheduler + webhook server |
| `automod` | Message filters (no timers) |
| `honeypot` | Trap warning post |
| `modcall` | Ticket relay (event-driven) |
| `stats` | Counter rename loop |
| `private` | Voice rooms + startup orphan sweep |

Priority: **Discord override → `MODULE_*` in `.env` → default on**.
`/modules status|enable|disable|restart|reset` (Administrator) controls runtime
state without restarting the bot; overrides persist in `data/store.json`.

### Publisher

Single pipeline for all publishing: `sources/* → normalize → dedup → queue →
router → formatter → Discord`. Sources never know the target channel; the router
decides `announcements` (HPSB releases/events/news, LIVE) vs `media`
(YouTube/Instagram/TikTok).

| Source | Primary | Fallback | Target |
|---|---|---|---|
| YouTube videos | PubSubHubbub push (`/hook/youtube`, HMAC-signed) | Data API → RSS → scrape | `#media` |
| YouTube live | Live check loop (`LIVE_CHECK_MINUTES`) | Data API search | `#announcements` (one LIVE message) |
| Twitch live | EventSub `stream.online/offline` (`/hook/twitch`, HMAC) | — | `#announcements` (one LIVE message) |
| Instagram | Webhook/API (`/hook/instagram`), legacy `/hook/news` compat | — | `#media` |
| TikTok | TikWM provider poll | — | `#media` |
| HPSB releases | API `rls.hpsbassline.club` | RSS | `#announcements` |
| HPSB events | API `events.hpsbassline.club` | RSS | `#announcements` (+24h/1h reminders) |
| HPSB news | RSS | — | `#announcements` |

Details:

- **Multistream LIVE**: Twitch + YouTube describe ONE physical stream. The second
  source updates the existing Discord message instead of posting another; buttons
  (`▶️ YouTube`, `🟣 Twitch`) come from live URLs plus `YOUTUBE_LIVE_URL` /
  `TWITCH_URL` fallbacks. Offline fires after 2 consecutive misses (no flapping).
- **Dedup**: key `source:type:id`, `pending → published | released`. Nothing is
  marked published before Discord confirms; failures retry. A boot **baseline**
  pass remembers everything without posting — a restart never re-posts history.
- **Polling is fallback**: push (PubSub/EventSub/webhooks) is primary; pollers
  back it up. Disabled sources get no timers, no subscriptions, no fetches.
- **Per-source runtime toggles**: `PUBLISHER_*` in `.env` are defaults;
  `/publisher enable|disable|reset <source>` overrides them live (module restarts
  internally to rebuild timers — never the whole bot).
- **Webhooks** (one Express server, `WEBHOOK_PORT`, `WEBHOOK_ENABLED=off` kills it):
  `/health`, `/hook/youtube`, `/hook/twitch`, `/hook/instagram`, `/hook/hpsb`,
  `/hook/news` (legacy compat). Publisher disabled → `503`; disabled source →
  ignored/`503`. See `src/modules/publisher/webhooks.js`.

### /sync modes

`/sync source:<...> mode:<...>` (default: `source=all, mode=missing`):

- `new` — only items unseen in memory (cap 5/source). `found N, posted 0` with
  the hint means "all already published".
- `republish` — re-post known items oldest-first (`count`, 1–25, default 10).
- `missing` — reconcile against **actual channel history** (last 100 messages)
  and post what's gone (default limit 25). For wiped/recreated channels. Refuses
  to run blind when history is unreadable.
- `backfill N` — newest N regardless of seen.

## Features

- **Music (Lavalink-only):** `/play` (text / links / playlists / direct mp3 /
  Bandcamp fan profile + `count`), `/radio`, `/queue`, `/nowplaying` (live ticking
  embed with buttons), `/skip [count]`, `/prev`, `/join`, `/loop`, `/shuffle`,
  `/remove`, `/move`, `/seek`, `/volume`, `/clear`, `/pause` (toggle), `/stop`,
  `/onair`. Sources: YouTube, SoundCloud, Bandcamp, Vimeo, Deezer/Apple/Tidal/
  Qobuz (LavaSrc, need tokens), HTTP radio/files. Spotify is OFF until the
  Spotify app gets Premium. Stage auto-speaker included.
- **Automod & honeypot:** flood/caps/links/invites/badwords, trap channel (first
  message = `timeout|kick|ban`; kick = softban with 24h wipe), anti-raid join
  spike. Bots are NOT exempt in the trap (raid bots are the target); own bot is.
  Behavior follows [RiskyMH/honeypot](https://github.com/RiskyMH/honeypot).
  `/honeypot status|test` diagnoses config, perms, role hierarchy (dry-run).
- **ModCall:** button → modal → staff ticket thread with two-way DM relay.
- **Stats:** Member-Count-style voice counters (`/counters setup|list|link`).
- **Private rooms:** join generator → own room + control panel, orphan sweep.
- **Partners:** `/partner-post` modal → Components-V2 card (wide banner gallery,
  title, links, start date) into `#partners`. Only manual writer.
- **Ops:** `/health` (channels, APIs, music, modules, store read/write),
  `/modules`, `/publisher`, `/sync`, `/publish`, `/version`.

## Requirements

- Node.js 20+, Java 17+ (for Lavalink), a Discord app with bot token.
- Dev Portal → Bot: enable **Server Members Intent**, **Message Content Intent**,
  **Presence Intent** (online/offline counters), **Guild Moderation** (ban events).
- Bot permissions: Administrator (or Manage Channels/Threads, Timeout Members,
  Connect/Speak, Send Messages/Embeds, Read History). The bot's top role must
  sit **above** punished users or timeout/kick/ban fail (see `/honeypot test`).

## Quickstart

1. `cp .env.example .env` and fill it (Discord token, guild/channel/role IDs).
   Every variable is typed (`string/secret/snowflake-id/boolean/integer/list/map/
   url/template`) — see the header of `.env.example`; same structure in `src/config.js`.
2. Lavalink (see `lavalink/README.md` for details):
   - download `Lavalink.jar` v4 into `lavalink/`;
   - `cp lavalink/application.example.yml lavalink/application.yml` and fill passwords/tokens;
   - keep `LAVALINK_PASSWORD` in sync between `application.yml` and bot `.env`.
3. `npm install` (if it complains about install-scripts: approve `opencode` + `ffmpeg-static`, then `npm rebuild`).
4. `node src/deploy-commands.js` — guild slash commands (also wipes stale globals;
   `wipe` = clean slate).
5. Start Lavalink: `java "-Djava.net.preferIPv4Stack=true" -jar Lavalink.jar` (quotes matter on PowerShell), wait for `ready to accept connections`.
6. `npm start` (background: PM2 / scheduler; logs in `data/bot.log`).
7. If the machine route to Discord flaps (IPv6/WARP): `index.js` and
   `deploy-commands.js` force `ipv4first`; login failures distinguish
   network-unreachable from a bad token.

## Project layout

- `src/commands/` — slash commands (41): music, moderation, publisher (`sync`,
  `publisher`, `modules`, `publish`, `partner-post`, `honeypot`, `counters`),
  info.
- `src/events/` — `ready` (Module Manager boot), `interactionCreate` (commands,
  buttons, modals), `voiceStateUpdate`, moderation/member events.
- `src/modules/manager.js` — lifecycle, runtime overrides.
- `src/modules/publisher/` — `index` (wiring), `pipeline`, `dedup`, `queue`,
  `router`, `formatter`, `live`, `state`, `scheduler`, `webhooks`,
  `source-state` (source overrides), `sources/` (fetch/normalize per platform,
  `channel-scan` for missing-mode).
- `src/modules/music/` — `engine-lavalink.js`, `service.js` (single entry),
  `resolvers.js`, `np.js`, `stage.js`, `bandcamp-fan.js`.
- `src/modules/` — `honeypot`, `modcall`, `stats`, `private`.
- `src/utils/` — embeds, music fmt, mod gates, selfcheck, logger, store
  (atomic JSON + in-process mutex).
- `lavalink/` — `application.example.yml`, plugins, README.
- `test/` — `node --test` suites (unit + pipeline with mocked Discord; real
  APIs never touched).

## Secrets discipline

Never committed (all gitignored): `.env`, `lavalink/application.yml`,
`lavalink/cookies.txt`, `lavalink/*.jar`, `data/*.json`. Templates are committed
instead. After every `git pull`, re-fill local secrets and restart Lavalink + bot.
