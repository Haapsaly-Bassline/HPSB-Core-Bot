const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Дизайн-токены HPSB: новые эмбеды — отсюда, старые мигрируют постепенно
const COLORS = {
  primary: 0x7c3aed,
  info: 0x0ea5e9,
  success: 0x22c55e,
  warning: 0xf59e0b,
  danger: 0xef4444,
  music: 0x1db954,
};

function baseEmbed({ title, description, url, image, color = 0x7c3aed, footer = 'Haapsaly Bassline' }) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title.slice(0, 256));
  if (description) e.setDescription(description.slice(0, 4000));
  if (url) e.setURL(url);
  if (image) e.setImage(image);
  if (footer) e.setFooter({ text: footer });
  return e;
}

function newsEmbed({ title, description, url, image, source = 'HPSB' }) {
  return baseEmbed({ title: `📰 ${title}`, description, url, image, footer: `HPSB • ${source}` });
}

// --- RF-style: ряд кнопок-ссылок (до 5 в ряду, ряды чанками) ---
// links: [{ label, url, emoji }]
function linkButtonRows(links = []) {
  const rows = [];
  for (let i = 0; i < links.slice(0, 25).length; i += 5) {
    const row = new ActionRowBuilder();
    for (const l of links.slice(i, i + 5)) {
      const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label.slice(0, 80)).setURL(l.url);
      if (l.emoji) b.setEmoji(l.emoji);
      row.addComponents(b);
    }
    rows.push(row);
  }
  return rows;
}

// --- Honeypot-варнинг как у RF: красный баннер + DO NOT POST ---
function honeypotEmbed({ punishment = 'мут 12ч', banner } = {}) {
  const e = new EmbedBuilder()
    .setColor(0xff2020)
    .setTitle('⛔ DO NOT POST IN HERE')
    .setDescription(
      'This channel serves as a honeypot for compromised accounts. ' +
      `A bot is monitoring any activity and will punish the user immediately (**${punishment}**). ` +
      'We will not be looking at appeals for people who want to take risks, accidental or as a joke.'
    )
    .setFooter({ text: 'HPSB-HONEYPOT • Haapsaly Bassline' })
    .setTimestamp();
  if (banner) e.setImage(banner);
  return e;
}

function trackLink(track) {
  const title = String(track.title || 'Unknown').slice(0, 300);
  return /^https?:\/\//i.test(track.url || '') ? `**[${title}](${track.url})**` : `**${title}**`;
}

// --- Jockie-style: Now Playing ---
function nowPlayingEmbed(track, queue, requester) {
  const { fmtMs, progressBar, currentProgress } = require('./music');
  const { currentMs, totalMs } = currentProgress(queue, track);
  const e = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('🔊 Now Playing ♪')
    .setDescription(`Playing\n${trackLink(track)}\n${track.author || ''}`.slice(0, 4000))
    .setTimestamp();
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  e.addFields({ name: 'Position', value: progressBar(currentMs, totalMs) });
  e.addFields(
    { name: 'Position in queue', value: '1', inline: true },
    { name: 'Position', value: fmtMs(currentMs), inline: true },
    { name: 'Length', value: totalMs > 0 ? fmtMs(totalMs) : String(track.duration || 'LIVE'), inline: true },
  );
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: 'Haapsaly Bassline • Music' });
  return e;
}

// --- Jockie-style: Added Track ---
function addedTrackEmbed(track, position, requester, eta, nextTitle) {
  const { fmtMs } = require('./music');
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('➕ Added Track')
    .setDescription(`Track\n${trackLink(track)}\n${track.author || ''}`.slice(0, 4000))
    .setTimestamp();
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  e.addFields(
    { name: 'Estimated time until played', value: eta != null && eta > 0 ? fmtMs(eta) : '0:00', inline: true },
    { name: 'Track Length', value: String(track.duration || 'LIVE'), inline: true },
  );
  e.addFields(
    { name: 'Position in upcoming', value: String(position ?? '?'), inline: true },
    { name: 'Next', value: nextTitle ? String(nextTitle).slice(0, 200) : '—', inline: true },
  );
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: 'Haapsaly Bassline • Music' });
  return e;
}

module.exports = { COLORS, baseEmbed, newsEmbed, linkButtonRows, honeypotEmbed, nowPlayingEmbed, addedTrackEmbed, modActionEmbed, punishLogEmbed };

// --- Мод-действие: единый красивый вывод (и в чат, и в лог) ---
// kind: warn/unwarn/mute/unmute/kick/ban/unban/purge
const MOD_STYLE = {
  warn:   { emoji: '⚠️', color: 0xf59e0b, title: 'Предупреждение' },
  unwarn: { emoji: '✅', color: 0x22c55e, title: 'Варн снят' },
  mute:   { emoji: '🔇', color: 0xef4444, title: 'Мут' },
  unmute: { emoji: '🔈', color: 0x22c55e, title: 'Мут снят' },
  kick:   { emoji: '👢', color: 0xf97316, title: 'Кик' },
  ban:    { emoji: '🔨', color: 0xdc2626, title: 'Бан' },
  unban:  { emoji: '✅', color: 0x22c55e, title: 'Разбан' },
  purge:  { emoji: '🧹', color: 0x0ea5e9, title: 'Чистка' },
};

function modActionEmbed(kind, { target, mod, reason, extra } = {}) {
  const st = MOD_STYLE[kind] || { emoji: '🛡', color: 0x7c3aed, title: kind };
  const e = new EmbedBuilder().setColor(st.color).setTitle(`${st.emoji} ${st.title}`).setTimestamp();
  const lines = [];
  if (target) lines.push(`**Нарушитель:** ${target}`);
  if (mod) lines.push(`**Модератор:** ${mod}`);
  if (reason) lines.push(`**Причина:** ${String(reason).slice(0, 500)}`);
  if (extra) lines.push(`**Детали:** ${String(extra).slice(0, 500)}`);
  e.setDescription(lines.join('\n').slice(0, 3500) || '_—_');
  e.setFooter({ text: 'Haapsaly Bassline • Moderation' });
  return e;
}

// --- Лог наказания honeypot/автомода ---
function punishLogEmbed({ what, member, reason, excerpt }) {
  const e = new EmbedBuilder().setColor(0xff2020).setTitle(`🍯 Honeypot • ${what}`).setTimestamp()
    .setDescription(`**Кто:** ${member}\n**Причина:** ${String(reason).slice(0, 500)}`.slice(0, 3500));
  if (excerpt) e.addFields({ name: 'Сообщение', value: String(excerpt).slice(0, 900) });
  e.setFooter({ text: 'Haapsaly Bassline • Automod' });
  return e;
}
