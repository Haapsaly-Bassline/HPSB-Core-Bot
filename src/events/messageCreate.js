const { Events } = require('discord.js');
const { handleMessage } = require('../modules/honeypot/detector');
const { relayUserDm, relayStaffMessage } = require('../modules/modcall/handler');
const { config } = require('../config');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;

    // 1) honeypot / automod (guild messages)
    if (message.guild) {
      // автопаблиш анонсов подписчикам (не ждём)
      if (config.autopublish.includes(message.channelId) && message.crosspostable) {
        message.crosspost().catch(() => {});
      }
      const relayed = await relayStaffMessage(message, client).catch(() => false);
      if (!relayed) await handleMessage(message, client).catch(() => {});
    } else {
      // 2) DM to bot -> possible modcall reply
      await relayUserDm(message, client).catch(() => {});
    }
  },
};
