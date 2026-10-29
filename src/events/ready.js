const { Events } = require('discord.js');
const { logger } = require('../utils/logger');

let retryTimer = null;

// manager.init() resolves before the node's websocket is actually up, so
// available() is false for a moment on every cold start. Poll briefly instead
// of declaring failure (and waiting 30s) on a perfectly healthy node.
async function waitForConnection(engine, timeoutMs = 10000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (engine.available()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return engine.available();
}

async function startMusic(client) {
  const { LavalinkEngine } = require('../modules/music/engine-lavalink');
  if (!client.music || typeof client.music.init !== 'function') {
    const engine = new LavalinkEngine(client, require('../config').config.music);
    await engine.init();
    client.music = engine;
    client.lavalink = engine;
  }
  if (await waitForConnection(client.music)) {
    logger.info('[music] lavalink connected');
    return;
  }
  // init() does NOT throw when the node is unreachable -- retry until connected.
  logger.error('[lavalink] NO CONNECTED NODES: check the remote node (host/port/password) and retry every 30s.');
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(async () => {
    try {
      await client.music.manager.init({ id: client.user.id, username: client.user.username || client.user.tag });
    } catch {}
    if (client.music.available()) {
      clearInterval(retryTimer);
      retryTimer = null;
      logger.info('[music] lavalink connected on retry');
    }
  }, 30000);
  retryTimer.unref?.();
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[ready] Logged in as ${client.user.tag}`);

    try {
      await startMusic(client);
    } catch (e) {
      logger.error('[music] failed to start:', e?.message || e);
    }
  },
};
