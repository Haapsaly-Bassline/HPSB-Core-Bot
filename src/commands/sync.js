const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');

function line(name, r) {
  if (!r) return `**${name}:** error`;
  if (r.skipped) return `**${name}:** skipped (previous run still active)`;
  if (r.filtered) return `**${name}:** — not selected`;
  return `**${name}:** found ${r.found ?? 0}, posted ${r.posted ?? 0}`;
}

const SOURCE_CHOICES = [
  { name: 'All', value: 'all' },
  { name: 'News (posts)', value: 'news' },
  { name: 'Releases', value: 'releases' },
  { name: 'Events', value: 'events' },
  { name: 'YouTube', value: 'youtube' },
  { name: 'TikTok', value: 'tiktok' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Force-sync feeds (releases/events/posts/reposters)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('source').setDescription('What to import').setRequired(false).addChoices(...SOURCE_CHOICES))
    .addStringOption(o => o.setName('mode').setDescription('New only, or republish known oldest-first').setRequired(false)
      .addChoices({ name: 'New only', value: 'new' }, { name: 'Republish (oldest first)', value: 'republish' }))
    .addIntegerOption(o => o.setName('count').setDescription('Republish limit (1–25, default 10)').setMinValue(1).setMaxValue(25))
    .addIntegerOption(o => o.setName('backfill').setDescription('Backfill the last N (0–5) even if already seen').setMinValue(0).setMaxValue(5)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const source = interaction.options.getString('source') || 'all';
    const mode = interaction.options.getString('mode') || 'new';
    const backfill = interaction.options.getInteger('backfill') || 0;
    const republish = mode === 'republish' ? (interaction.options.getInteger('count') || 10) : 0;
    const sources = source === 'all' ? null : [source];
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return; // interaction already dead
    }
    try {
      const { runHpsbOnce } = require('../modules/site-publisher/poller');
      const { runReposterOnce } = require('../modules/reposter/poller');
      const h = await runHpsbOnce(client, { backfill, sources, republish });
      const r = await runReposterOnce(client, { sources, republish });
      if (!h || !r) {
        await replyError(interaction, '❌ Sync error (runner failed).');
        return;
      }
      const e = new EmbedBuilder()
        .setColor(0x7c3aed).setTitle('🔄 Sync').setTimestamp()
        .setDescription([
          line('💿 Releases', h.releases),
          line('📅 Events', h.events),
          line('📰 News', h.posts),
          line('⏰ Reminders', h.reminders),
          line('▶️ YouTube', r.youtube),
          line('🎵 TikTok', r.tiktok),
        ].join('\n'))
        .setFooter({ text: `${source !== 'all' ? `source=${source} • ` : ''}${mode === 'republish' ? `republish≤${republish} • ` : ''}${backfill ? `backfill=${backfill} • ` : ''}Haapsaly Bassline` });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await replyError(interaction, `❌ Sync error: ${String(err.message || err).slice(0, 300)}`);
    }
  },
};
