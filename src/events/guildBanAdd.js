const { Events } = require('discord.js');
const { modLog } = require('../utils/mod');

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    try {
      const reason = ban.reason || 'Без причины';
      // audit-log: кто забанил
      let by = '—';
      try {
        const logs = await ban.guild.fetchAuditLogs({ type: 22, limit: 3 });
        const hit = logs.entries.find(e => e.target?.id === ban.user.id);
        if (hit) by = `${hit.executor} (${hit.executor.id})`;
      } catch {}
      await modLog(ban.client, `🔨 **Ban** ${ban.user.tag} (${ban.user.id})\nПричина: ${reason}\nМод: ${by}`);
    } catch {}
  },
};
