const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');

function entry(color, title, desc, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (desc) e.setDescription(String(desc).slice(0, 3500));
  for (const f of fields.slice(0, 6)) e.addFields({ name: f[0], value: String(f[1]).slice(0, 900), inline: false });
  return e;
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      if (message.author?.bot) return;
      if (!message.guild) return;
      // automod/honeypot сами логгируют — не дублируем свежие удаления бота
      await modLog(message.client,
        { embeds: [entry(0xef4444, '🗑 Сообщение удалено',
          message.content ? message.content.slice(0, 1500) : '_текст недоступен (не было в кэше)_',
          [['Автор', `${message.author} (${message.author?.id})`], ['Канал', `<#${message.channelId}>`]])] });
    } catch {}
  },
};
