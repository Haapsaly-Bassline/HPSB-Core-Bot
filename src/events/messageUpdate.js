const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMsg, newMsg, client) {
    try {
      if (client?.readyTimestamp && (Date.now() - client.readyTimestamp < 60000)) return;
      if (newMsg.author?.bot || !newMsg.guild) return;
      const before = (oldMsg.content || '').slice(0, 1000);
      const after = (newMsg.content || '').slice(0, 1000);
      if (!before || before === after) return; // only text edits, not embeds
      const e = new EmbedBuilder().setColor(0xf59e0b).setTitle('✏️ Message edited').setTimestamp()
        .addFields(
          { name: 'Author', value: `${newMsg.author} (${newMsg.author.id})` },
          { name: 'Channel', value: `<#${newMsg.channelId}> [jump](${newMsg.url})` },
          { name: 'Before', value: before },
          { name: 'After', value: after },
        );
      await modLog(newMsg.client, { embeds: [e] });
    } catch {}
  },
};
