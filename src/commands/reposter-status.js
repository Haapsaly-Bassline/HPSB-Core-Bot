const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod } = require('../utils/mod');
const { config } = require('../config');

// Legacy name kept for muscle memory; shows the NEW Publisher source wiring
// (mappings, poll intervals, effective on/off incl. Discord overrides).
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reposter-status')
    .setDescription('Publisher source wiring status')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!await requireMod(interaction)) return;
    const { youtube, tiktok, pollMinutes } = config.reposter;
    let srcRows = [];
    try {
      const { sourceStatus } = require('../modules/publisher');
      srcRows = sourceStatus().map((s) =>
        `${s.state === 'on' ? '🟢' : s.state === 'disabled' ? '⚪' : '⚠️'} ${s.emoji} ${s.label}: ${s.state}`);
    } catch {}
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        `🔁 Media poll every ${pollMinutes} min • HPSB poll every ${config.hpsb.pollMinutes} min • live check every ${config.publisher.live.checkMinutes} min.\n` +
        `YouTube: ${youtube.length ? youtube.map(x => `${x.key} -> <#${x.channelId}>`).join('\n') : '_empty_'}\n` +
        `TikTok: ${tiktok.length ? tiktok.map(x => `${x.key} -> <#${x.channelId}>`).join('\n') : '_empty_'}\n` +
        `Instagram: webhook/API only (no polling provider)\n` +
        (srcRows.length ? `\n**Effective sources**\n${srcRows.join('\n')}` : ''),
    });
  },
};
