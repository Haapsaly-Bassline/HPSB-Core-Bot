# HPSB Lavalink on Docker: official v4 image + ffmpeg + fresh yt-dlp.
# Mirrors the local Windows setup (youtube-plugin 1.18.2, LavaSrc 4.8.3,
# ytdlp + burner cookies) on a Linux server.
FROM ghcr.io/lavalink-devs/lavalink:4

USER root

# ffmpeg (transcoding) + python (yt-dlp runtime) + deno (yt-dlp needs a JS
# runtime for current YouTube challenges; without it some videos fail).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Deno (official installer) for yt-dlp JS challenges.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# yt-dlp fresh from pip at BUILD time (breaks fast, keep it current;
# rebuild the image when YouTube links start failing).
# NOTE: lavalink:4 base is Ubuntu 22.04 Jammy with pip 22.0.2 which does NOT
# know --break-system-packages (added in pip 23). So upgrade pip first,
# then the flag works on both old and new bases.
RUN pip3 install --no-cache-dir -U pip && pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider
# NOTE: bgutil plugin mints YouTube PO tokens via the sidecar `pot` service
# (see docker-compose.yml). yt-dlp auto-uses it; base_url is passed in
# application.yml extractor-args. Cookies stay as fallback (PO token alone
# does not bypass IP-based login checks).

# LavaSrc parses `yt-dlp -J` stdout as STRICT JSON. On Python <=3.10 yt-dlp
# prints "Deprecated Feature: Support for Python version 3.10 ..." into the
# process output and Jackson dies with "Unrecognized token 'Deprecated'" --
# every YT load becomes "No results" while plain exec looks fine.
# Fix: ignore Python warnings + drop yt-dlp's stderr (stdout JSON untouched).
# Debug with yt-dlp-real (same binary, stderr kept).
ENV PYTHONWARNINGS=ignore
RUN mv /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp-real && \
    printf '#!/bin/sh\nexport PYTHONWARNINGS=ignore\nexec /usr/local/bin/yt-dlp-real "$@" 2>/dev/null\n' > /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

RUN yt-dlp --version && ffmpeg -version | head -n1 && deno --version

WORKDIR /opt/Lavalink

# Back to the image default user is handled by ENTRYPOINT; nothing else needed.
# Config + cookies + plugins come from mounted volumes (see docker-compose.yml).
