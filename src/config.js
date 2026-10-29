require('dotenv').config();

function parseIds(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

// Music-only branch: all configuration is Discord + a remote Lavalink node.
const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID,
  guildId: process.env.GUILD_ID,
  // Shown in embed footers / /version.
  botName: process.env.BOT_NAME || 'HPSB Music',
  // Optional: bot owners who always pass /health and /perms gates.
  adminIds: parseIds(process.env.ADMIN_DISCORD_IDS),

  music: {
    // Lavalink v4 node. Can live on another server: set the public/private
    // host, port and password here (and LAVALINK_SECURE=true behind TLS).
    lavalink: {
      host: process.env.LAVALINK_HOST || '127.0.0.1',
      port: Number(process.env.LAVALINK_PORT || 2333),
      password: process.env.LAVALINK_PASSWORD || '',
      secure: (process.env.LAVALINK_SECURE || 'false') === 'true',
      nodeId: process.env.LAVALINK_NODE_ID || 'main',
      requestTimeoutMs: Number(process.env.LAVALINK_REQUEST_TIMEOUT_MS || 30000),
    },
    // Text search source when the query is not a URL:
    // youtube | soundcloud | spotify | deezer | applemusic | tidal | qobuz | yandex | vk
    defaultSearchSource: (process.env.DEFAULT_SEARCH_SOURCE || 'youtube').toLowerCase(),
  },
};

function validate() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (!config.guildId) missing.push('GUILD_ID');
  if (!config.music.lavalink.password) missing.push('LAVALINK_PASSWORD');
  if (missing.length) {
    console.warn('[config] Missing required env:', missing.join(', '));
  }
}

module.exports = { config, validate };
