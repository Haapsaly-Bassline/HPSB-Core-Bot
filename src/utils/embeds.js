const { EmbedBuilder } = require('discord.js');
const { config } = require('../config');

// Design tokens: shared by all music overlays.
const COLORS = {
  primary: 0x7c3aed,
  info: 0x0ea5e9,
  success: 0x22c55e,
  warning: 0xf59e0b,
  danger: 0xef4444,
  music: 0x1db954,
  accent: 0x5865f2, // blurple -- music "added / queue action" family
};

const MUSIC_FOOTER = `${config.botName} • Music`;

// Compact confirmation embed for control commands (skip/pause/stop/...).
// Errors stay plain ephemeral text; successes share one look.
function ack(title, desc, { color = COLORS.accent, footer = MUSIC_FOOTER } = {}) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(String(title).slice(0, 256));
  if (desc) e.setDescription(String(desc).slice(0, 2000));
  if (footer) e.setFooter({ text: footer });
  return e;
}

function trackLink(track) {
  const title = String(track.title || 'Unknown').slice(0, 300);
  return /^https?:\/\//i.test(track.url || '') ? `**[${title}](${track.url})**` : `**${title}**`;
}

// --- Jockie-style: Added Track ---
// track: { title, url, author, thumbnail, duration, source }
function addedTrackEmbed(track, position, requester, eta, nextTitle, source) {
  const { fmtMs } = require('./music');
  const badge = sourceBadge(source || track.source);
  const e = new EmbedBuilder()
    .setColor(COLORS.accent)
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
    { name: 'Next', value: nextTitle ? String(nextTitle).slice(0, 200) : '-', inline: true },
  );
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: MUSIC_FOOTER });
  return e;
}

// --- Playlist/album added: unified overlay instead of plain-text ---
function playlistAddedEmbed({ title, count, first, source }, requester) {
  const badge = sourceBadge(source || first?.source);
  const e = new EmbedBuilder()
    .setColor(COLORS.accent)
    .setTitle(`📃 Playlist added${badge ? ` • ${badge}` : ''}`)
    .setDescription(
      `**${String(title || 'playlist').slice(0, 300)}**\n` +
      `Tracks added: **${count}**` +
      (first?.title ? `\nFirst: ${trackLink(first)}` : '')
    ).setTimestamp();
  if (first?.thumbnail) e.setThumbnail(first.thumbnail);
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: MUSIC_FOOTER });
  return e;
}

// --- Radio/live stream: unified overlay instead of plain-text ---
function liveAddedEmbed({ label, url, source }, requester) {
  const e = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('📻 Live / Radio')
    .setDescription(
      `**${String(label || 'Stream').slice(0, 300)}**\n` +
      `🔴 LIVE${source && source !== 'http' ? ` • ${sourceBadge(source)}` : ''}` +
      (url ? `\n${url}` : '')
    ).setTimestamp();
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: MUSIC_FOOTER });
  return e;
}

// --- Bandcamp fan collection: batch of albums from purchases ---
function fanCollectionEmbed({ fanName, fanUrl, added, failed, totalTracks }, requester) {
  const lines = added.slice(0, 10).map((a, i) =>
    `\`${i + 1}.\` 💿 **${String(a.title).slice(0, 150)}**${a.band ? ` - ${String(a.band).slice(0, 100)}` : ''} (${a.count} tracks)`
  );
  const more = added.length > 10 ? `\n…and ${added.length - 10} more` : '';
  const e = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`💿 Fan collection • ${String(fanName || 'Bandcamp').slice(0, 200)}`)
    .setDescription(
      `Albums/releases added: **${added.length}**, tracks: **${totalTracks}**` +
      (failed ? ` (failed: ${failed})` : '') +
      `\n\n${lines.join('\n')}${more}`.slice(0, 3800)
    ).setTimestamp();
  if (fanUrl) e.setURL(fanUrl);
  if (requester) e.addFields({ name: 'Requested by', value: `${requester}`, inline: false });
  e.setFooter({ text: MUSIC_FOOTER });
  return e;
}

// Source badge for overlays. Empty = not shown.
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

module.exports = {
  COLORS, MUSIC_FOOTER, ack, trackLink,
  addedTrackEmbed, playlistAddedEmbed, liveAddedEmbed, fanCollectionEmbed, sourceBadge,
};
