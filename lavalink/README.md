# Lavalink — host PC setup (Jockie-level music)

Why: Jockie runs on Java + Lavalink (their public repos are Java infra, including
a conscrypt TLS fork — they fight detection at the TLS layer). Repeating their
TLS patches in Node is unrealistic, but offloading audio to Lavalink is not:
all fetching/transcoding lives in the Java process, the bot only controls it.

## Requirements (Windows host PC)
- Java 17+: https://adoptium.net/ → Temurin 17 JRE `.msi` installer
  (check: `java -version` in a fresh PowerShell window)
- Node.js 20+ for the bot itself

## Setup (Windows)
1. Download `Lavalink.jar` into this folder:
   https://github.com/lavalink-devs/Lavalink/releases (take v4, the `Lavalink.jar` file)
2. Copy the template and fill secrets (this file is gitignored and never committed):
   ```powershell
   Copy-Item application.example.yml application.yml
   ```
   - set `lavalink.server.password` and mirror it into the bot `.env` (`LAVALINK_PASSWORD`);
   - paste tokens as needed (see matrix below): YouTube OAuth `refreshToken`,
     LavaSrc `arl` / `masterDecryptionKey` / store tokens, Spotify keys;
   - check plugin versions against their GitHub releases.
3. First manual run for verification (PowerShell inside `lavalink\`):
   ```powershell
   java "-Djava.net.preferIPv4Stack=true" -jar Lavalink.jar
   ```
   Wait for `Lavalink is ready to accept connections` on port 2333 (no plugin errors).
   Quotes around `-D...` are required, otherwise PowerShell splits the flag.
4. Autostart: Task Scheduler → `java.exe` with arguments
   `"-Djava.net.preferIPv4Stack=true" -jar "C:\path\to\lavalink\Lavalink.jar"`,
   working directory = `lavalink\`, trigger on system start. Or a `.bat` in autostart:
   ```bat
   @echo off
   cd /d C:\HPSB\lavalink
   java "-Djava.net.preferIPv4Stack=true" -jar Lavalink.jar
   ```
5. Bot `.env`: `MUSIC_ENGINE=lavalink`, `LAVALINK_HOST=127.0.0.1`,
   `LAVALINK_PORT=2333`, `LAVALINK_PASSWORD=...` (same as step 2).

`preferIPv4Stack`: some ISPs have hanging IPv6 (timeout instead of refusal) and,
unlike Node, Java has no Happy Eyeballs — without the flag, occasional requests
(e.g. to the Spotify API) die with `Read timed out`.

## What you get
- All providers from one place (YouTube/Spotify/Apple/Deezer/SoundCloud/Bandcamp/HTTP)
- Spotify via ISRC — exact matches instead of lookalikes
- Playlists, `ytsearch:`/`scsearch:` search, queue and filters — like Jockie
- The bot survives Lavalink restarts (reconnects), audio doesn't depend on the bot's network

## Source matrix (live-tested 2026-10-04)

The bot runs EXCLUSIVELY on Lavalink (legacy engine removed from code).

| Source | Status | Needed |
|---|---|---|
| SoundCloud / Bandcamp / HTTP radio | ✅ work | nothing |
| Vimeo | ❌ off | source is dead |
| Spotify (links + `spsearch:`) | ❌ off | needs Premium on the Spotify app owner; keys stay in the block for later |
| Deezer | ⏳ waits for tokens | `arl` (deezer.com cookie) + `masterDecryptionKey`; unlocks direct audio + Spotify mirror without YouTube |
| Apple Music / Tidal / Qobuz | ⏳ wait for tokens | blocks are pre-wired in yml, flip `sources.*: true` after pasting the token |
| YouTube | ⚠️ partial | Search/metadata — plugin. Direct links — ytdlp with burner cookies (`cookies.txt`, local only, gitignored). Unrestricted videos play from text search; login-required ones only via links through ytdlp. Full return — OAuth already on (TV client). |
| Yandex / VK | ❌ removed | owner decision |
| Audiomack | ❌ unavailable | not covered by this stack (LavaSrc ytdlp source is YouTube-only); only direct mp3 links work |

Token guides: https://github.com/topi314/LavaSrc#configuration
(Spotify / Apple Music / Deezer / Tidal / Qobuz sections).

## YouTube cookies (burner account)
1. Log into a **burner** Google account (NOT the main one) in Chrome/Edge.
2. Install the **Get cookies.txt LOCALLY** extension, open `youtube.com`, Export.
3. Save as `cookies.txt` next to `application.yml` (gitignored, never commit — it is a live session).
4. Cookies expire every few weeks — re-export when YouTube links start failing.
