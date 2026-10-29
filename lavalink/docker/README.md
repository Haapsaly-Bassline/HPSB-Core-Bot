# Lavalink in Docker (server) — 1:1 move from the Windows host

Goal: same node, same versions, same cookies — only the machine changes.
The **bot stays where it is**; only Lavalink moves. Voice keeps working:
Lavalink joins Discord voice itself, the bot only sends it control commands
(small extra latency bot↔node is fine; audio path is node→Discord directly).

## 1. Prepare files (on the Windows host)

In `lavalink/docker/` you need 3 files (all gitignored, never commit):

```powershell
cd lavalink/docker
Copy-Item ..\application.yml .\application.yml
Copy-Item ..\cookies.txt .\cookies.txt
# plugin jars only (NOT the loose .class mess in plugins\):
Copy-Item ..\plugins\youtube-plugin-1.18.2.jar .\plugins\
Copy-Item ..\plugins\lavasrc-plugin-4.8.3.jar .\plugins\
```

Then edit the **copy** `lavalink/docker/application.yml` — 3 Windows paths
must become container paths (everything else stays byte-identical,
passwords/tokens/OAuth untouched):

```yaml
# ytdlp.path:
path: "/usr/local/bin/yt-dlp"
# ytdlp.customLoadArgs / customPlaybackArgs, replace BOTH cookie paths:
"--cookies", "/opt/Lavalink/cookies.txt",
```


**SoundCloud:** the updated config uses the Soundy 1.1.0 community plugin from JitPack and disables Lavalink's broken built-in SoundCloud source. Make sure the `application.yml` copied into this Docker folder has the Soundy dependency and `lavalink.server.sources.soundcloud: false`. Lavalink downloads the dependency from JitPack at startup; no extra Soundy JAR needs to be copied manually. Restart with `docker compose up -d` after changing the config.

## 2. Ship to the server

```powershell
scp -r lavalink/docker user@SERVER:/opt/hpsb-lavalink
```

(`application.yml` + `cookies.txt` contain live secrets — scp only, no git,
no chat, no screenshots.)

> **Alternative: move an already-built image.** If you built here and don't
> want to rebuild there (or the target has slow internet):
> ```powershell
> docker build -t hpsb-lavalink:4 lavalink/docker
> docker save hpsb-lavalink:4 | gzip > hpsb-lavalink.tar.gz
> scp hpsb-lavalink.tar.gz user@SERVER:/opt/
> ```
> On Ubuntu: `docker load -i /opt/hpsb-lavalink.tar.gz`, then still copy
> `docker-compose.yml` + `application.yml` + `cookies.txt` + `plugins/` and
> `docker compose up -d` (no `--build`). Note: cross-architecture (e.g.
> amd64 → ARM) does NOT work this way — rebuild on the target instead.
> Rebuilding on the target is preferred anyway: it bakes in the freshest
> yt-dlp.

## 3. Start on the server

```bash
cd /opt/hpsb-lavalink
docker compose up -d --build
docker compose logs -f   # wait for "Lavalink is ready to accept connections"
```

No plugin errors + `ready to accept connections` on `:2333` = success.

## 4. Point the bot at it

In the bot `.env` (bot itself does NOT move, no code changes needed):

```env
LAVALINK_HOST=<docker-server-IP-or-hostname>   # was 127.0.0.1
LAVALINK_PORT=2333                             # same
LAVALINK_PASSWORD=<same as lavalink.server.password>
LAVALINK_SECURE=false                          # true only behind TLS
```

Restart the bot. `/health` → `✅ lavalink: <host>:2333 reachable`.
Music commands are unchanged; if the node is down they answer cleanly
instead of cryptic errors.

## 5. Day-2 operations

- **YouTube auth = PO tokens** (`pot` sidecar, no cookies needed). Links
  start failing → `docker compose up -d --build` (fresh yt-dlp + plugin +
  pot image). Last resort if the IP gets flagged: re-add burner `cookies.txt`
  mount + `--cookies` args (history in git), then `docker compose restart`.
- **yt-dlp rots fast**: `docker compose build --no-cache && docker compose up -d`
  pulls a fresh yt-dlp (pip at build time). Rebuild when links fail.
- **Plugins**: pinned in `application.yml` (`youtube-plugin:1.18.2`,
  `lavasrc:4.8.3`); bump versions there, `docker compose up -d` re-downloads
  (or drop new jars into `plugins/`).
- **Firewall**: `:2333` has only the password for auth — bind/publish it to
  trusted nets only (see the commented examples in `docker-compose.yml`),
  ideally bot-IP-only.
- **OAuth refreshToken**: lives in `application.yml` and refreshes itself;
  keep the file safe (it is a Google session of the burner account).

## Why Docker and not a second bare install

- One `Dockerfile` = ffmpeg + yt-dlp + deno, versioned and rebuildable;
  no "works on my machine" drift between host PC and server.
- Volumes keep the mutable bits (config/cookies/plugins) outside the image,
  so rebuilds never eat secrets.
- No Java install on the server; the image brings its own JRE.
