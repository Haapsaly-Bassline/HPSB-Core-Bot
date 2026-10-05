const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { config } = require('../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[ready] Logged in as ${client.user.tag}`);

    // All subsystems boot through the Module Manager (enable/disable via
    // MODULE_* env + /modules overrides). One module never takes down the rest.
    try {
      const { startAll } = require('../modules/manager');
      await startAll(client);
    } catch (e) { logger.warn('[modules] startAll failed:', e.message); }

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
