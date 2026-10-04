const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');

function entry(color, title, desc, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (desc) e.setDescription(String(desc).slice(0, 3500));
  for (const f of fields.slice(0, 6)) e.addFields({ name: f[0], value: String(f[1]).slice(0, 900), inline: false });
  return e;
}

// Grace period after startup: Discord backlog events not logged
function inGrace(client) {
  return client.readyTimestamp && (Date.now() - client.readyTimestamp < 60000);
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message, client) {
    try {
      if (inGrace(client)) return;
      if (message.author?.bot) return;
      if (!message.guild) return;
      // Junk events without author and text (uncached/system) -- skip
      if (!message.author && !message.content) return;
      await modLog(client,
        { embeds: [entry(0xef4444, '🗑 Message deleted',
          message.content ? message.content.slice(0, 1500) : '_text unavailable (not in cache)_',
          [
            ['Author', message.author ? `${message.author} (${message.author.id})` : `_unknown (message id ${message.id})_`],
            ['Channel', `<#${message.channelId}>`],
          ])] });
    } catch {}
  },
};
