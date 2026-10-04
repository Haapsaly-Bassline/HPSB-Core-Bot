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

// --- Jockie-style: Added Track ---
// track: { title, url, author, thumbnail, duration, source }
// source: короткий код источника (spotify/soundcloud/deezer/…/http) — покажем бейдж.
function addedTrackEmbed(track, position, requester, eta, nextTitle, source) {
  const { fmtMs } = require('./music');
  const badge = sourceBadge(source || track.source);
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`➕ Added Track${badge ? ` • ${badge}` : ''}`)
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

// --- Плейлист/альбом добавлен: единый оверлей вместо plain-text ---
function playlistAddedEmbed({ title, count, first, source }, requester) {
  const badge = sourceBadge(source || first?.source);
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📃 Playlist added${badge ? ` • ${badge}` : ''}`)
    .setDescription(
      `**${String(title || 'playlist').slice(0, 300)}**\n` +
      `Треков добавлено: **${count}**` +
      (first?.title ? `\nПервый: ${trackLink(first)}` : '')
    ).setTimestamp();
  if (first?.thumbnail) e.setThumbnail(first.thumbnail);
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: 'Haapsaly Bassline • Music' });
  return e;
}

// --- Радио/прямой эфир: единый оверлей вместо plain-text ---
function liveAddedEmbed({ label, url, source }, requester) {
  const e = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('📻 Live / Radio')
    .setDescription(
      `**${String(label || 'Stream').slice(0, 300)}**\n` +
      `🔴 LIVE${source && source !== 'http' ? ` • ${sourceBadge(source)}` : ''}` +
      (url ? `\n${url}` : '')
    ).setTimestamp();
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: 'Haapsaly Bassline • Music' });
  return e;
}

// --- Bandcamp fan-коллекция: пачка альбомов из купленного ---
function fanCollectionEmbed({ fanName, fanUrl, added, failed, totalTracks }, requester) {
  const lines = added.slice(0, 10).map((a, i) =>
    `\`${i + 1}.\` 💿 **${String(a.title).slice(0, 150)}**${a.band ? ` — ${String(a.band).slice(0, 100)}` : ''} (${a.count} тр.)`
  );
  const more = added.length > 10 ? `\n…и ещё ${added.length - 10}` : '';
  const e = new EmbedBuilder()
    .setColor(0x1f9d55)
    .setTitle(`💿 Fan collection • ${String(fanName || 'Bandcamp').slice(0, 200)}`)
    .setDescription(
      `Альбомов/релизов добавлено: **${added.length}**, треков: **${totalTracks}**` +
      (failed ? ` (не открылось: ${failed})` : '') +
      `\n\n${lines.join('\n')}${more}`.slice(0, 3800)
    ).setTimestamp();
  if (fanUrl) e.setURL(fanUrl);
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: 'Haapsaly Bassline • Music' });
  return e;
}

// Бейдж источника для оверлеев. Пусто = не показываем.
const SOURCE_BADGES = {
  spotify: '🟢 Spotify', soundcloud: '🟠 SoundCloud', deezer: '🟣 Deezer',
  applemusic: '🍎 Apple Music', tidal: '⬛ Tidal', qobuz: '🔵 Qobuz',
  yandex: '🟡 Yandex', vk: '🔷 VK', youtube: '🔴 YouTube',
  bandcamp: '💿 Bandcamp', vimeo: '🎬 Vimeo', twitch: '🟪 Twitch',
  http: '🌐 HTTP', arbitrary: '🌐 Stream',
};
function sourceBadge(source) {
  return SOURCE_BADGES[String(source || '').toLowerCase()] || '';
}

// Пинг роли для объявлений (медиа + анонсы). Пусто = без пинга.
function announcePing() {
  try {
    const { config } = require('../config');
    return config.announceRoleId ? `<@&${config.announceRoleId}>` : '';
  } catch { return ''; }
}

// Пинг роли для МЕДИА (YT/IG/TT). Пусто = падаем на общую announceRoleId.
function mediaPing() {
  try {
    const { config } = require('../config');
    const id = config.mediaRoleId || config.announceRoleId;
    return id ? `<@&${id}>` : '';
  } catch { return ''; }
}

// EN-шаблоны объявлений: {role} {author} {user} {title} {link}
// roleOverride: mediaPing() для медиа-постов, иначе общая announcePing().
function renderTpl(tpl, vars = {}, roleOverride) {
  const role = roleOverride !== undefined ? roleOverride : announcePing();
  return String(tpl || '')
    .split('{role}').join(role)
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { COLORS, baseEmbed, newsEmbed, linkButtonRows, honeypotEmbed, addedTrackEmbed, playlistAddedEmbed, liveAddedEmbed, fanCollectionEmbed, sourceBadge, modActionEmbed, punishLogEmbed, announcePing, mediaPing, renderTpl };

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
