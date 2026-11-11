# HPSB Music Bot - music-only branch

A stripped-down, music-only Discord bot. Everything unrelated to music
(moderation, publisher/reposter, automod, honeypot, ModCall, stats, private
rooms) is removed. Audio is played by a **remote Lavalink v4 node**, so the
bot host only needs Node.js and network access to the node.

## Commands

| Command | What it does |
| --- | --- |
| `/play <query> [channel] [count]` | Search or play a URL: YouTube, SoundCloud (incl. `m.soundcloud.com` / `on.soundcloud.com` links), Bandcamp, direct mp3/stream, playlists. Bandcamp fan profiles queue purchases; SoundCloud profiles support tracks, albums, sets, likes and reposts (`count` = items, 1-25). SoundCloud playback/search requires the `soundy` plugin on the node |
| `/join [channel]` | Move the bot to your voice channel / a specified one |
| `/queue` | Current track + upcoming |
| `/nowplaying` | Snapshot of the live Now Playing message |
| `/skip [count]` | Skip one or several tracks |
| `/loop <mode>` | Repeat off / track / queue |
| `/shuffle`, `/remove`, `/move`, `/clear` | Queue management |
| `/seek <time>`, `/volume <0-200>`, `/pause`, `/stop` | Playback control (`1:30`, `90`, `+30`, `-15`); volume is remembered per guild across restarts |
| `/perms [channel]`, `/health`, `/version` | Diagnostics (Manage Server for `/health` and `/perms`) |

The Now Playing message has live buttons: shuffle, previous, pause/resume,
next, loop, plus a seek row (−30s, −10s, +10s, +30s and an exact-time modal).
Buttons work only for members in the same voice channel; live streams hide the
seek row.

## Volume memory

`/volume` is stored per guild in `data/music-volumes.json` (created on the first
change, gitignored) and applied whenever a player is created, so the level
survives bot and Lavalink restarts. Range 0-200, default 100.

## Requirements

- Node.js 20+
- A Lavalink v4 server (local or on another machine) with a password
- Discord application/bot token

No native Opus/FFmpeg builds are needed: the Lavalink node decodes and streams
the audio, the bot only sends voice state/gateway payloads.

**No privileged intents are required.** Only `Guilds` and `GuildVoiceStates`
are used, so nothing needs to be enabled in the Developer Portal beyond the
defaults.

Bot permissions in voice: **View Channel**, **Connect**, **Speak** (on Stage
channels Speak is replaced by the speaker request; `Manage Channels` helps the
bot unsuppress itself). Send Messages + Embed Links in the text channel.

## Quickstart

1. Copy `.env.example` to `.env` and fill:
   - `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`
   - `LAVALINK_HOST`, `LAVALINK_PORT`, `LAVALINK_PASSWORD`,
     `LAVALINK_SECURE` (set `true` for wss/https)
   - optional: `BOT_NAME`, `MUSIC_DEFAULT_SEARCH_SOURCE`, `NP_UPDATE_SECS`,
     `LAVALINK_NODE_ID`, `LAVALINK_REQUEST_TIMEOUT_MS`
2. `npm install`
3. `npm run register` - registers guild slash commands
4. `npm start`

Logs go to the console and `data/bot.log`.

## Remote Lavalink notes

- The bot connects to `LAVALINK_HOST:LAVALINK_PORT`; the node must be
  reachable from the bot host (open the port in the firewall/security group).
- Use the **same** `LAVALINK_PASSWORD` in `.env` and in the node's
  `application.yml` -> `lavalink.server.password`.
- Source plugins (YouTube plugin, LavaSrc for Spotify/Deezer/Apple/Tidal/Qobuz,
  etc.) are configured **on the Lavalink server**, not in this bot. If the node
  does not have a source enabled, `/play` for that source will fail.
- **SoundCloud:** use the `soundy` plugin on the node and disable the built-in
  Lavalink source (`soundcloud: false`, `soundcloudSearchEnabled: false`); the
  built-in source is broken. `soundcloud.com`, `m.soundcloud.com` and
  `on.soundcloud.com` links are routed to it. Profile imports use SoundCloud's
  public web API and do not need the plugin, but playback of the imported
  tracks does.
- **YouTube:** use the bgutil POT sidecar (`pot` service) with no cookies.
- The `lavalink/` folder in this repo is only a reference (config template,
  Docker files; the Jar is gitignored). The bot does not start or manage
  Lavalink itself.
- Text queries use `MUSIC_DEFAULT_SEARCH_SOURCE` (fallback
  `DEFAULT_SEARCH_SOURCE`, default `youtube`). URLs are routed by their domain.

## Project layout

- `src/commands/` - slash commands (music + diagnostics)
- `src/events/` - `ready` (Lavalink init + retry), `interactionCreate`
  (commands + NP buttons), `voiceStateUpdate` (stage speaker re-request)
- `src/modules/music/` - `engine-lavalink.js` (queue/voice), `service.js`
  (single entry point), `resolvers.js` (query routing), `np.js` (live Now
  Playing + seek UI), `stage.js` (stage speaker), `bandcamp-fan.js` (fan
  collections), `soundcloud-profile.js` (profile tabs)
- `src/utils/` - embeds (overlays), music formatting, logger, voice preflight
- `src/config.js` - env parsing (Discord + Lavalink only)
- `data/` - runtime state (`bot.log`, `music-volumes.json`); JSON/log files are
  gitignored
- `lavalink/` - optional Lavalink template / Docker setup

## Tests

```bash
npm test
```

Covers embeds (including SoundCloud profile overlays), music formatting, query
resolvers (including `m.soundcloud.com` / `on.soundcloud.com` routing), the NP
seek UI, Bandcamp fan parsing, SoundCloud profile parsing and the engine-null
guards.
