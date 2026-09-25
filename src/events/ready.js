const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { config } = require('../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[ready] Logged in as ${client.user.tag}`);

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

    // Самопроверка прав при старте — без плейсхолдеров, живьём из API
    try {
      const { auditGuild } = require('../utils/selfcheck');
      const { missing } = await auditGuild(client);
      if (missing.length) {
        const id = config.logChannelId || config.honeypot.logChannelId;
        const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
        if (ch?.isTextBased()) {
          await ch.send(`⚠️ **Self-check:** боту не хватает прав на сервере:\n❌ ${missing.join('\n❌ ')}`).catch(() => {});
        }
      }
    } catch (e) { logger.warn('[selfcheck] disabled:', e.message); }

    if (config.modcall.panelChannelId) {
      logger.info('[modcall] ready, use /modcall-panel to post the button');
    }
  },
};
