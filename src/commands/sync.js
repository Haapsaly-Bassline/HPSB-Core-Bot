const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');

function line(name, r) {
  if (!r) return `**${name}:** error`;
  if (r.skipped) return `**${name}:** skipped (previous run still active)`;
  return `**${name}:** found ${r.found ?? 0}, posted ${r.posted ?? 0}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Force-sync feeds (releases/events/posts/reposters)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('backfill').setDescription('Backfill the last N (0–5) even if already seen').setMinValue(0).setMaxValue(5)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const backfill = interaction.options.getInteger('backfill') || 0;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return; // interaction already dead
    }
    try {
      const { runHpsbOnce } = require('../modules/site-publisher/poller');
      const { runReposterOnce } = require('../modules/reposter/poller');
      const h = await runHpsbOnce(client, { backfill });
      const r = await runReposterOnce(client);
      if (!h || !r) {
        await replyError(interaction, '❌ Sync error (runner failed).');
        return;
      }
      const { EmbedBuilder } = require('discord.js');
      const e = new EmbedBuilder()
        .setColor(0x7c3aed).setTitle('🔄 Sync').setTimestamp()
        .setDescription([
          line('💿 Releases', h.releases),
          line('📅 Events', h.events),
          line('📰 Posts', h.posts),
          line('⏰ Reminders', h.reminders),
          line('▶️ YouTube', r.youtube),
          line('🎵 TikTok', r.tiktok),
        ].join('\n'))
        .setFooter({ text: `${backfill ? `backfill=${backfill} • ` : ''}Haapsaly Bassline` });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await replyError(interaction, `❌ Sync error: ${String(err.message || err).slice(0, 300)}`);
    }
  },
};
