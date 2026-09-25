const { Events } = require('discord.js');
const { modLog } = require('../utils/mod');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    try {
      await modLog(ban.client, `✅ **Unban** ${ban.user.tag} (${ban.user.id})`);
    } catch {}
  },
};
