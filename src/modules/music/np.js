// Живой Now Playing (как Notes): одно сообщение на гильдию, тикающий
// прогресс-бар и кнопки. Движок не важен — всё через MusicService.
// Обновление раз в NP_UPDATE_SECS (мин. 5).
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { fmtMs, progressBar } = require('../../utils/music');
const { logger } = require('../../utils/logger');
const music = require('./service');

const UPDATE_SECS = Math.max(5, Number(process.env.NP_UPDATE_SECS || 10));
const sessions = new Map(); // guildId -> { channelId, messageId, timer }

function buildEmbed(snap) {
  const t = snap.track;
  const linked = /^https?:\/\//i.test(t.url || '') ? `[${t.title}](${t.url})` : `**${t.title}**`;
  const e = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Now Playing')
    .setDescription(`${linked}\n${t.author || ''}`.slice(0, 3500))
    .setTimestamp();
  if (t.thumbnail) e.setThumbnail(t.thumbnail);
  const left = snap.durationMs > 0 ? fmtMs(snap.positionMs) : 'LIVE';
  const right = snap.durationMs > 0 ? fmtMs(snap.durationMs) : t.durationLabel || 'LIVE';
  e.addFields({ name: '​', value: `\`${left}\` ${progressBar(snap.positionMs, snap.durationMs, 18)} \`${right}\`` });
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
  if (!snap) { await finalize(client, guildId, 'Очередь завершена'); return false; }
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
  sessions.delete(guildId);
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
      e.setFooter({ text: `${note || 'Остановлено'} • Haapsaly Bassline` });
      await msg.edit({ embeds: [e], components: [] }).catch(() => {});
    }
  } catch {}
}

// Кнопки. Только для тех, кто сидит в том же войсе, что и бот.
async function handleButton(interaction, client) {
  const guildId = interaction.guildId;
  let snap = null;
  try { snap = music.npSnapshot(client, guildId); } catch { snap = null; }
  if (!snap) {
    await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  let botVoice = null;
  try { botVoice = music.voiceChannelId(client, guildId); } catch { botVoice = null; }
  const myChannel = interaction.member?.voice?.channelId;
  if (!myChannel || (botVoice && myChannel !== botVoice)) {
    await interaction.reply({ content: '❌ Зайди в тот же войс, где играет бот.', flags: MessageFlags.Ephemeral }).catch(() => {});
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

module.exports = { trackStart, render, finalize, handleButton };
