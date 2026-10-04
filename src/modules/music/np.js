// Live Now Playing (like Notes): one message per guild, ticking
// progress bar and buttons. Engine doesn't matter -- all via MusicService.
// Updates every NP_UPDATE_SECS (min 5).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { fmtMs, progressBar } = require('../../utils/music');
const { logger } = require('../../utils/logger');
const music = require('./service');

const UPDATE_SECS = Math.max(5, Number(process.env.NP_UPDATE_SECS || 10));
const sessions = new Map(); // guildId -> { channelId, messageId, timer }

const { sourceBadge } = require('../../utils/embeds');

function buildEmbed(snap) {
  const t = snap.track;
  const badge = sourceBadge(t.source);
  const linked = /^https?:\/\//i.test(t.url || '') ? `[${t.title}](${t.url})` : `**${t.title}**`;
  const head = snap.radioLabel ? `📻 **${String(snap.radioLabel).slice(0, 200)}**\n` : '';
  const e = new EmbedBuilder()
    .setColor(snap.radioLabel || t.isLive ? 0xef4444 : 0x57f287)
    .setTitle(snap.radioLabel ? '📻 Live / Radio' : `Now Playing${badge ? ` • ${badge}` : ''}`)
    .setDescription(`${head}${linked}\n${snap.radioLabel || t.author || ''}`.slice(0, 3500))
    .setTimestamp();
  if (t.thumbnail) e.setThumbnail(t.thumbnail);
  const left = snap.durationMs > 0 ? fmtMs(snap.positionMs) : 'LIVE';
  const right = snap.durationMs > 0 ? fmtMs(snap.durationMs) : t.durationLabel || 'LIVE';
  e.addFields({ name: '​', value: `\`${left}\` ${progressBar(snap.positionMs, snap.durationMs, 18)} \`${right}\`` });
  if ((snap.size ?? 0) > 0) e.addFields({ name: '📋 In queue', value: String(snap.size), inline: true });
  if (badge && snap.radioLabel) e.addFields({ name: 'Source', value: badge, inline: true });
  e.setFooter({ text: t.requesterTag ? `Requested by ${t.requesterTag}` : 'Haapsaly Bassline • Music' });
  return e;
}

function loopButton(mode) {
  if (mode === 1) return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔂').setStyle(ButtonStyle.Success);
  if (mode === 2) return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔁').setStyle(ButtonStyle.Primary);
  return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary);
}

function buildRow(snap) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('np:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:prev').setEmoji('⏮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:pause').setEmoji(snap.paused ? '▶️' : '⏸').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('np:next').setEmoji('⏭').setStyle(ButtonStyle.Secondary),
    loopButton(snap.repeatMode),
  );
}

function stopTimer(guildId) {
  const s = sessions.get(guildId);
  if (s?.timer) clearInterval(s.timer);
}

async function render(client, guildId) {
  const s = sessions.get(guildId);
  if (!s) return false;
  let snap = null;
  try { snap = music.npSnapshot(client, guildId); } catch { snap = null; }
  if (!snap) { await finalize(client, guildId, 'Queue finished'); return false; }
  try {
    const ch = await client.channels.fetch(s.channelId).catch(() => null);
    if (!ch?.isTextBased()) { stopTimer(guildId); sessions.delete(guildId); return false; }
    const msg = await ch.messages.fetch(s.messageId).catch(() => null);
    if (!msg) { stopTimer(guildId); sessions.delete(guildId); return false; }
    await msg.edit({ embeds: [buildEmbed(snap)], components: [buildRow(snap)] });
    return true;
  } catch {
    stopTimer(guildId);
    sessions.delete(guildId);
    return false;
  }
}

async function trackStart(client, guildId, channel) {
  stopTimer(guildId);
// Old NP message goes away (footer + remove buttons), new track -- always NEW
// message: editing buried-in-history NP nobody will see.
  const prev = sessions.get(guildId);
  sessions.delete(guildId);
  if (prev?.messageId) {
    try {
      const ch = await client.channels.fetch(prev.channelId).catch(() => null);
      const msg = ch?.isTextBased?.() ? await ch.messages.fetch(prev.messageId).catch(() => null) : null;
      if (msg) {
        const e = EmbedBuilder.from(msg.embeds[0] || new EmbedBuilder().setTitle('Now Playing'));
        e.setFooter({ text: 'Played • Haapsaly Bassline' });
        await msg.edit({ embeds: [e], components: [] }).catch(() => {});
      }
    } catch {}
  }
  if (!channel?.isTextBased?.()) return;
  let snap = null;
  try { snap = music.npSnapshot(client, guildId); } catch { snap = null; }
  if (!snap) return;
  try {
    const msg = await channel.send({ embeds: [buildEmbed(snap)], components: [buildRow(snap)] });
    const timer = setInterval(() => render(client, guildId).catch(() => {}), UPDATE_SECS * 1000);
    timer.unref?.();
    sessions.set(guildId, { channelId: channel.id, messageId: msg.id, timer });
  } catch (e) { logger.warn('[np] send failed', e.message); }
}

async function finalize(client, guildId, note) {
  const s = sessions.get(guildId);
  stopTimer(guildId);
  sessions.delete(guildId);
  if (!s) return;
  try {
    const ch = await client.channels.fetch(s.channelId).catch(() => null);
    const msg = ch?.isTextBased?.() ? await ch.messages.fetch(s.messageId).catch(() => null) : null;
    if (msg) {
      const e = EmbedBuilder.from(msg.embeds[0] || new EmbedBuilder().setTitle('Now Playing'));
      e.setFooter({ text: `${note || 'Stopped'} • Haapsaly Bassline` });
      await msg.edit({ embeds: [e], components: [] }).catch(() => {});
    }
  } catch {}
}

// Buttons. Only for those in the same voice channel as the bot.
async function handleButton(interaction, client) {
  const guildId = interaction.guildId;
  let snap = null;
  try { snap = music.npSnapshot(client, guildId); } catch { snap = null; }
  if (!snap) {
    await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  let botVoice = null;
  try { botVoice = music.voiceChannelId(client, guildId); } catch { botVoice = null; }
  const myChannel = interaction.member?.voice?.channelId;
  if (!myChannel || (botVoice && myChannel !== botVoice)) {
    await interaction.reply({ content: '❌ Join the same voice channel the bot is playing in.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  try {
    const id = interaction.customId;
    if (id === 'np:shuffle') await music.shuffle(client, guildId);
    else if (id === 'np:prev') await music.prev(client, guildId);
    else if (id === 'np:pause') await music.pause(client, guildId, !snap.paused);
    else if (id === 'np:next') await music.skip(client, guildId);
    else if (id === 'np:loop') await music.loop(client, guildId, ((snap.repeatMode ?? 0) + 1) % 3);
    await interaction.deferUpdate().catch(() => {});
    await render(client, guildId);
  } catch (e) {
    logger.warn('[np] button failed', e.message);
  }
  return true;
}

module.exports = { trackStart, render, finalize, handleButton, buildEmbed };
