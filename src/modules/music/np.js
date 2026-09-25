// Живой Now Playing (как Notes): одно сообщение на гильдию, тикающий
// прогресс-бар и кнопки управления. Обновление раз в NP_UPDATE_SECS (мин. 5).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { fmtMs, progressBar, currentProgress } = require('../../utils/music');
const { logger } = require('../../utils/logger');

const UPDATE_SECS = Math.max(5, Number(process.env.NP_UPDATE_SECS || 10));
const sessions = new Map(); // guildId -> { channelId, messageId, timer }

function trackTitle(track, queue) {
  const radio = queue?.metadata?.radioLabel;
  if (radio) return `📻 ${radio}`;
  return track.title || 'Unknown';
}

function buildEmbed(track, queue, requester) {
  const { currentMs, totalMs } = currentProgress(queue, track);
  const title = trackTitle(track, queue);
  const linked = /^https?:\/\//i.test(track.url || '') && !queue?.metadata?.radioLabel
    ? `[${title}](${track.url})`
    : `**${title}**`;
  const e = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Now Playing')
    .setDescription(`${linked}\n${track.author || ''}`.slice(0, 3500))
    .setTimestamp();
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  const left = totalMs > 0 ? fmtMs(currentMs) : 'LIVE';
  const right = totalMs > 0 ? fmtMs(totalMs) : (track.duration || 'LIVE');
  e.addFields({ name: '\u200b', value: `\`${left}\` ${progressBar(currentMs, totalMs, 18)} \`${right}\`` });
  e.setFooter({ text: requester ? `Requested by ${requester.tag || requester}` : 'Haapsaly Bassline • Music' });
  return e;
}

function loopButton(mode) {
  // 0 off, 1 track, 2 queue, 3 autoplay
  if (mode === 1) return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔂').setStyle(ButtonStyle.Success);
  if (mode === 2 || mode === 3) return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔁').setStyle(ButtonStyle.Primary);
  return new ButtonBuilder().setCustomId('np:loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary);
}

function buildRow(queue) {
  const paused = !!queue?.node?.isPaused?.();
  const mode = queue?.repeatMode ?? 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('np:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:prev').setEmoji('⏮').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np:pause').setEmoji(paused ? '▶️' : '⏸').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('np:next').setEmoji('⏭').setStyle(ButtonStyle.Secondary),
    loopButton(mode),
  );
}

function stopTimer(guildId) {
  const s = sessions.get(guildId);
  if (s?.timer) clearInterval(s.timer);
}

async function render(client, guildId) {
  const s = sessions.get(guildId);
  if (!s) return false;
  const queue = client.player.nodes.get(guildId);
  if (!queue?.currentTrack) { await finalize(client, guildId, 'Очередь завершена'); return false; }
  try {
    const ch = await client.channels.fetch(s.channelId).catch(() => null);
    if (!ch?.isTextBased()) { stopTimer(guildId); sessions.delete(guildId); return false; }
    const msg = await ch.messages.fetch(s.messageId).catch(() => null);
    if (!msg) { stopTimer(guildId); sessions.delete(guildId); return false; }
    const requester = queue.metadata?.requester || queue.currentTrack.requestedBy;
    await msg.edit({ embeds: [buildEmbed(queue.currentTrack, queue, requester)], components: [buildRow(queue)] });
    return true;
  } catch {
    stopTimer(guildId);
    sessions.delete(guildId);
    return false;
  }
}

async function trackStart(client, queue, track) {
  const guildId = queue.guild.id;
  stopTimer(guildId);
  sessions.delete(guildId);
  const channel = queue.metadata?.channel;
  if (!channel?.isTextBased?.()) return;
  try {
    const requester = queue.metadata?.requester || track.requestedBy;
    const msg = await channel.send({ embeds: [buildEmbed(track, queue, requester)], components: [buildRow(queue)] });
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
      e.setFooter({ text: `${note || 'Остановлено'} • Haapsaly Bassline` });
      await msg.edit({ embeds: [e], components: [] }).catch(() => {});
    }
  } catch {}
}

// Кнопки. Только для тех, кто сидит в том же войсе, что и бот.
async function handleButton(interaction, client) {
  const guildId = interaction.guildId;
  const queue = client.player.nodes.get(guildId);
  if (!queue?.currentTrack) {
    await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  const myChannel = interaction.member?.voice?.channelId;
  if (!myChannel || myChannel !== queue.channel?.id) {
    await interaction.reply({ content: '❌ Зайди в тот же войс, где играет бот.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  try {
    const id = interaction.customId;
    if (id === 'np:shuffle' && queue.tracks.size > 0) queue.tracks.shuffle();
    else if (id === 'np:prev') { try { await queue.history.previous(); } catch {} }
    else if (id === 'np:pause') queue.node.isPaused() ? queue.node.setPaused(false) : queue.node.setPaused(true);
    else if (id === 'np:next') queue.node.skip();
    else if (id === 'np:loop') queue.setRepeatMode(((queue.repeatMode ?? 0) + 1) % 3);
    await interaction.deferUpdate().catch(() => {});
    await render(client, guildId);
  } catch (e) {
    logger.warn('[np] button failed', e.message);
  }
  return true;
}

module.exports = { trackStart, render, finalize, handleButton };
