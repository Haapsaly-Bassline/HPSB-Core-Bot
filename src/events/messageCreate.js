const { Events } = require('discord.js');
const { handleMessage } = require('../modules/honeypot/detector');
const { relayUserDm, relayStaffMessage } = require('../modules/modcall/handler');
const { config } = require('../config');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    // Bots are ignored everywhere EXCEPT the honeypot trap: raid bots posting
    // there are exactly what the trap is for (own warning message is exempt).
    if (message.author.bot) {
      if (message.guild && message.author.id !== client.user?.id) {
        try {
          const { handleTrapMessage } = require('../modules/honeypot/detector');
          await handleTrapMessage(message, client);
        } catch (e) {
          logger.warn('[messageCreate] trap failed', e?.message || e);
        }
      }
      return;
    }

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
