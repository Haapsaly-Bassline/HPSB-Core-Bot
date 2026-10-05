const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod } = require('../utils/mod');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reposter-status')
    .setDescription('Reposter subscription status')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!await requireMod(interaction)) return;
    const { youtube, tiktok, pollMinutes } = config.reposter;
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `🔁 Poll every ${pollMinutes} min.\n` +
        `YouTube: ${youtube.length ? youtube.map(x => `${x.key} -> <#${x.channelId}>`).join('\n') : '_empty_'}\n` +
        `TikTok: ${tiktok.length ? tiktok.map(x => `${x.key} -> <#${x.channelId}>`).join('\n') : '_empty_'}\n` +
        `Instagram: via Make webhook (scraper removed)`,
    });
  },
};
