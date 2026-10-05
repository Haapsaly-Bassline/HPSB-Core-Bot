const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');

const SOURCE_CHOICES = [
  { name: 'All', value: 'all' },
  { name: 'HPSB (releases+events+news)', value: 'hpsb' },
  { name: 'News', value: 'news' },
  { name: 'Releases', value: 'releases' },
  { name: 'Events', value: 'events' },
  { name: 'Media (YT+TT+IG)', value: 'media' },
  { name: 'YouTube', value: 'youtube' },
  { name: 'TikTok', value: 'tiktok' },
  { name: 'Instagram', value: 'instagram' },
];

function line(emoji, name, r) {
  if (!r) return `${emoji} **${name}:** error`;
  if (r.filtered) return `${emoji} **${name}:** — not selected`;
  if (r.disabled) return `${emoji} **${name}:** — disabled`;
  if (r.unavailable) return `${emoji} **${name}:** — unavailable (not configured)`;
  if (r.error) return `${emoji} **${name}:** error (${r.error})`;
  return `${emoji} **${name}:** found ${r.found ?? 0}, posted ${r.posted ?? 0}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Force-sync Publisher feeds (oldest-first)')
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
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return; // interaction already dead
    }
    try {
      const pub = require('../modules/publisher');
      let pipeline = pub.getPipeline();
      let owned = false;
      let ownedRun = null;
      if (!pipeline) {
        // Publisher module stopped: run sync on an ad-hoc pipeline (sender
        // goes straight to Discord, nothing persists beyond dedup in memory).
        const { config } = require('../config');
        const { createPipeline } = require('../modules/publisher/pipeline');
        const { loadState } = require('../modules/publisher/state');
        pipeline = createPipeline({ client, config, log: console });
        pipeline.dedup.loadSeen(loadState().seen);
        ownedRun = pipeline.start();
        owned = true;
      }
      let out;
      try {
        out = await pub.runSync(pipeline, require('../config').config, {
          sources: source, backfill, republish,
        });
      } finally {
        if (owned) {
          pipeline.stop();
          await ownedRun;
        }
      }
      if (!out) {
        await replyError(interaction, '❌ Sync error (runner failed).');
        return;
      }
      const e = new EmbedBuilder()
        .setColor(0x7c3aed).setTitle('🔄 Publisher Sync').setTimestamp()
        .setDescription([
          line('💿', 'Releases', out.releases),
          line('📅', 'Events', out.events),
          line('📰', 'News', out.news),
          line('▶️', 'YouTube', out.youtube),
          line('🎵', 'TikTok', out.tiktok),
          line('📸', 'Instagram', out.instagram),
        ].join('\n'))
        .setFooter({ text: `${source !== 'all' ? `source=${source} • ` : ''}${mode === 'republish' ? `republish≤${republish} • ` : ''}${backfill ? `backfill=${backfill} • ` : ''}oldest-first • Haapsaly Bassline` });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await replyError(interaction, `❌ Sync error: ${String(err.message || err).slice(0, 300)}`);
    }
  },
};
