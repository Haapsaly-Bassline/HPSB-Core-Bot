const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reposter-status')
    .setDescription('Статус подписок репостера')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const { youtube, tiktok, pollMinutes } = config.reposter;
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `🔁 Poll каждые ${pollMinutes} мин.\n` +
        `YouTube: ${youtube.length ? youtube.map(x => `${x.key} → <#${x.channelId}>`).join('\n') : '_пусто_'}\n` +
        `TikTok: ${tiktok.length ? tiktok.map(x => `${x.key} → <#${x.channelId}>`).join('\n') : '_пусто_'}\n` +
        `Instagram: через Make-вебхук (скрапер удалён)`,
    });
  },
};
