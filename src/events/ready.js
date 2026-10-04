const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { config } = require('../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[ready] Logged in as ${client.user.tag}`);

// Lavalink -- ONLY AFTER ready: client.user exists, required by lavalink-client.
// Bot exclusively on lavalink: no legacy fallback. If failed -- music
// unavailable, commands reply "Music engine not initialized".
    if (config.music.engine === 'lavalink') {
      try {
        const { LavalinkEngine } = require('../modules/music/engine-lavalink');
        const engine = await new LavalinkEngine(client, config.music).init();
        client.music = engine;
        client.lavalink = engine;
        logger.info('[lavalink] ready (client.music = lavalink)');
      } catch (e) {
        logger.error('[lavalink] init failed:', e?.message || e?.stack || e);
        logger.error('[lavalink] music UNAVAILABLE: check LAVALINK_* in .env and that java -jar Lavalink.jar is running');
      }
    } else {
      logger.error(`[music] MUSIC_ENGINE=${config.music.engine} no longer supported -- legacy removed, set lavalink`);
    }

    // Start pollers lazily so index stays lean
    try {
      const { startReposter } = require('../modules/reposter/poller');
      startReposter(client);
    } catch (e) { logger.warn('[reposter] disabled:', e.message); }

    try {
      const { startSitePoller } = require('../modules/site-publisher/poller');
      startSitePoller(client);
    } catch (e) { logger.warn('[site] disabled:', e.message); }

    try {
      const { startWebhook } = require('../modules/site-publisher/webhook');
      startWebhook(client);
    } catch (e) { logger.warn('[webhook] disabled:', e.message); }

    try {
      const { ensureTrapWarning } = require('../modules/honeypot/detector');
      await ensureTrapWarning(client);
    } catch (e) { logger.warn('[honeypot] disabled:', e.message); }

    try {
      const { startStats } = require('../modules/stats/counter');
      startStats(client);
    } catch (e) { logger.warn('[stats] disabled:', e.message); }

    // Self-check permissions at startup -- no placeholders, live from API
    try {
      const { auditGuild } = require('../utils/selfcheck');
      const { missing } = await auditGuild(client);
      if (missing.length) {
        const id = config.logChannelId || config.honeypot.logChannelId;
        const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
        if (ch?.isTextBased()) {
          await ch.send(`⚠️ **Self-check:** bot missing perms on server:\n❌ ${missing.join('\n❌ ')}`).catch(() => {});
        }
      }
    } catch (e) { logger.warn('[selfcheck] disabled:', e.message); }

    if (config.modcall.panelChannelId) {
      logger.info('[modcall] ready, use /modcall-panel to post the button');
    }
  },
};
