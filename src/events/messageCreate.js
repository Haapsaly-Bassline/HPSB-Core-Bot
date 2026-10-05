const { Events } = require('discord.js');
const { handleMessage } = require('../modules/honeypot/detector');
const { relayUserDm, relayStaffMessage } = require('../modules/modcall/handler');
const { config } = require('../config');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;

    // 1) honeypot / automod (guild messages)
    if (message.guild) {
      // autopublish announcements to followers (fire and forget)
      if (config.autopublish.includes(message.channelId) && message.crosspostable) {
        message.crosspost().catch(() => {});
      }
      const relayed = await relayStaffMessage(message, client).catch((e) => {
        logger.warn('[messageCreate] staff relay failed', e?.message || e);
        return false;
      });
      if (!relayed) {
        await handleMessage(message, client).catch((e) => {
          // Never silent: a dead automod looks exactly like "does nothing".
          logger.warn('[messageCreate] automod failed', e?.message || e);
        });
      }
    } else {
      // 2) DM to bot -> possible modcall reply
      await relayUserDm(message, client).catch((e) => {
        logger.warn('[messageCreate] dm relay failed', e?.message || e);
      });
    }
  },
};
