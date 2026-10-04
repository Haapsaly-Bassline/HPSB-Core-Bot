const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { requireMod } = require('../utils/mod');

function line(name, r) {
  return `**${name}:** found ${r.found}, posted ${r.posted}`;
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { runHpsbOnce } = require('../modules/site-publisher/poller');
      const { runReposterOnce } = require('../modules/reposter/poller');
      const h = await runHpsbOnce(client, { backfill });
      const r = await runReposterOnce(client);
      if (!h || !r) {
        await interaction.editReply('⏳ Previous sync is still running — try again in a minute.');
        return;
      }
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
      await interaction.editReply(`❌ Sync error: ${String(err.message || err).slice(0, 300)}`).catch(() => {});
    }
  },
};
