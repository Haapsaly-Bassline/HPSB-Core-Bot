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

function line(emoji, name, r, mode) {
  if (!r) return `${emoji} **${name}:** error`;
  if (r.filtered) return `${emoji} **${name}:** — not selected`;
  if (r.disabled) return `${emoji} **${name}:** — disabled`;
  if (r.unavailable) return `${emoji} **${name}:** — unavailable (not configured)`;
  if (r.error) return `${emoji} **${name}:** error (${r.error})`;
  const base = `${emoji} **${name}:** found ${r.found ?? 0}, posted ${r.posted ?? 0}`;
  // Explain a confusing zero: everything found is already published --
  // use mode=republish (repost known) or mode=missing (repost what's gone).
  if (mode === 'new' && (r.found ?? 0) > 0 && !r.posted && !r.note) {
    return `${base}\n↳ _all already published — mode=republish to repost, mode=missing to restore wiped channels_`;
  }
  // Show WHY nothing came back (blocked transport, rate limit) -- not just 0.
  if (!r.posted && r.note) return `${base}\n↳ _${String(r.note).slice(0, 200)}_`;
  return base;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Force-sync Publisher feeds (oldest-first)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('source').setDescription('What to import').setRequired(false).addChoices(...SOURCE_CHOICES))
    .addStringOption(o => o.setName('mode').setDescription('How to sync (default: missing in channel)').setRequired(false)
      .addChoices(
        { name: 'Missing in channel (restore wiped)', value: 'missing' },
        { name: 'New only', value: 'new' },
        { name: 'Republish known (oldest first)', value: 'republish' }))
    .addIntegerOption(o => o.setName('count').setDescription('Limit for republish/missing (1–25)').setMinValue(1).setMaxValue(25))
    .addIntegerOption(o => o.setName('backfill').setDescription('Backfill the last N (0–5) even if already seen').setMinValue(0).setMaxValue(5)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const source = interaction.options.getString('source') || 'all';
    // Default = missing: sync publishes whatever the channel lost (recreated
    // channels, purged history). Memory-only 'new' would skip it all silently.
    const mode = interaction.options.getString('mode') || 'missing';
    const backfill = interaction.options.getInteger('backfill') || 0;
    // republish default 10, missing default 25 (channel restore wants them all).
    const countOpt = interaction.options.getInteger('count');
    const republish = mode === 'republish' ? (countOpt || 10) : 0;
    const missing = mode === 'missing';
    const missingLimit = missing ? (countOpt || 25) : 0;
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
          sources: source, backfill, republish, missing, missingLimit, client,
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
          line('💿', 'Releases', out.releases, mode),
          line('📅', 'Events', out.events, mode),
          line('📰', 'News', out.news, mode),
          line('▶️', 'YouTube', out.youtube, mode),
          line('🎵', 'TikTok', out.tiktok, mode),
          line('📸', 'Instagram', out.instagram, mode),
        ].join('\n'))
        .setFooter({ text: `${source !== 'all' ? `source=${source} • ` : ''}${mode !== 'new' ? `mode=${mode} • ` : ''}${backfill ? `backfill=${backfill} • ` : ''}oldest-first • Haapsaly Bassline` });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await replyError(interaction, `❌ Sync error: ${String(err.message || err).slice(0, 300)}`);
    }
  },
};
