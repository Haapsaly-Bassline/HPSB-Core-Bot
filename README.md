# HPSB Music Bot — music-only branch

A stripped-down, music-only Discord bot. Everything unrelated to music
(moderation, publisher/reposter, automod, honeypot, ModCall, stats, private
rooms) is removed. Audio is played by a **remote Lavalink v4 node**, so the
bot host only needs Node.js and network access to the node.

## Commands

| Command | What it does |
| --- | --- |
| `/play <query> [channel] [count]` | Search or play a URL: YouTube, SoundCloud, Bandcamp, Deezer, Apple Music, Tidal, Qobuz, Yandex, VK, direct mp3/radio, playlists. A Bandcamp fan profile queues that fan's purchases (`count` = releases, 1–25) |
| `/radio [station] [url] [channel]` | HPSB radio stations or any custom stream URL |
| `/join [channel]` | Move the bot to your voice channel / a specified one |
| `/queue` | Current track + upcoming |
| `/nowplaying` | Snapshot of the live Now Playing message |
| `/skip [count]` | Skip one or several tracks |
| `/loop <mode>` | Repeat off / track / queue |
| `/shuffle`, `/remove`, `/move`, `/clear` | Queue management |
| `/seek <time>`, `/volume <0-200>`, `/pause`, `/stop` | Playback control |
| `/onair [station]` | HPSB radio now-playing metadata |
| `/perms [channel]`, `/health`, `/version` | Diagnostics (Manage Server for `/health` and `/perms`) |

The Now Playing message has live buttons: shuffle, previous, pause/resume,
next, loop. Buttons work only for members in the same voice channel.

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
2. `npm install`
3. `npm run register` — registers guild slash commands
4. `npm start`

Logs go to the console and `data/bot.log`.

## Remote Lavalink notes

- The bot connects to `LAVALINK_HOST:LAVALINK_PORT`; the node must be
  reachable from the bot host (open the port in the firewall/security group).
- Use the **same** `LAVALINK_PASSWORD` in `.env` and in the node's
  `application.yml` → `lavalink.server.password`.
- Source plugins (YouTube plugin, LavaSrc for Spotify/Deezer/Apple/Tidal/Qobuz,
  etc.) are configured **on the Lavalink server**, not in this bot. If the node
  does not have a source enabled, `/play` for that source will fail.
- The `lavalink/` folder in this repo is only a reference (config template,
  Docker files; the Jar is gitignored). The bot does not start or manage
  Lavalink itself.
- Text queries use `DEFAULT_SEARCH_SOURCE` (default `youtube`). URLs are routed
  by their domain.

## Project layout

- `src/commands/` — slash commands (music + diagnostics)
- `src/events/` — `ready` (Lavalink init + retry), `interactionCreate`
  (commands + NP buttons), `voiceStateUpdate` (stage speaker re-request)
- `src/modules/music/` — `engine-lavalink.js` (queue/voice), `service.js`
  (single entry point), `resolvers.js` (query routing), `np.js` (live Now
  Playing), `stage.js` (stage speaker), `bandcamp-fan.js` (fan collections)
- `src/utils/` — embeds (overlays), music formatting, logger, voice preflight
- `src/config.js` — env parsing (Discord + Lavalink only)
- `lavalink/` — optional Lavalink template / Docker setup

## Tests

```bash
npm test
```

Covers embeds, music formatting, query resolvers and the engine-null guards.
