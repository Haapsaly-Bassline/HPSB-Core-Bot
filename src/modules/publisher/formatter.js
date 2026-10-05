// Publisher formatter: normalized event -> Discord embed + buttons (+ping text).
// One look per source family; never a bare link when an embed is possible.
const { EmbedBuilder } = require('discord.js');
const { linkButtonRows } = require('../../utils/embeds');

function str(v, n) {
  return String(v ?? '').slice(0, n);
}

// Only real http(s) URLs reach discord.js builders (setURL/setImage throw
// on garbage, which would wedge the event -- see pipeline worker).
function safeUrl(v) {
  const s = String(v || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 400) : '';
}

function linkedTitle(ev) {
  const t = str(ev.title || 'Untitled', 250);
  const u = safeUrl(ev.url);
  return u ? `**[${t}](${u})**` : `**${t}**`;
}

function base(color, ev) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  const img = safeUrl(ev.image);
  const thumb = safeUrl(ev.thumbnail);
  if (img) e.setImage(img);
  else if (thumb) e.setThumbnail(thumb);
  e.setFooter({ text: 'Haapsaly Bassline' });
  return e;
}

function youtube(ev) {
  const e = base(0xff0000, ev)
    .setTitle(`▶️ YouTube`)
    .setDescription(`${linkedTitle(ev)}\n${ev.author ? `by **${str(ev.author, 100)}**` : ''}`.slice(0, 3500));
  return { embed: e, buttons: ev.url ? [{ label: '▶️ Watch on YouTube', url: ev.url }] : [] };
}

function instagram(ev) {
  const user = ev.author ? `@${String(ev.author).replace(/^@/, '').slice(0, 100)}` : '';
  const e = base(0xe1306c, ev)
    .setTitle('📸 Instagram')
    .setDescription(`${linkedTitle(ev)}\n${user ? `by **${user}**` : ''}`.slice(0, 3500));
  return { embed: e, buttons: ev.url ? [{ label: '📸 Open Instagram', url: ev.url }] : [] };
}

function tiktok(ev) {
  const user = ev.author ? `@${String(ev.author).replace(/^@/, '').slice(0, 100)}` : '';
  const e = base(0x1a1a1a, ev)
    .setTitle('🎵 TikTok')
    .setDescription(`${linkedTitle(ev)}\n${user ? `by **${user}**` : ''}`.slice(0, 3500));
  return { embed: e, buttons: ev.url ? [{ label: '🎵 Open TikTok', url: ev.url }] : [] };
}

function twitchLive(ev, extraButtons = []) {
  const e = base(0x9146ff, ev)
    .setTitle('🔴 HPSB is LIVE')
    .setDescription(`${linkedTitle(ev)}\n${str(ev.description || 'The stream is now live.', 500)}`.slice(0, 3500));
  return { embed: e, buttons: extraButtons };
}

function release(ev) {
  const m = ev.metadata || {};
  const lines = [`${linkedTitle(ev)}`];
  if (m.artist) lines.push(`by **${str(m.artist, 100)}**`);
  if (ev.description) lines.push(str(ev.description, 1200));
  const info = [];
  if (Array.isArray(m.genre) && m.genre.length) info.push(`Genre: ${m.genre.slice(0, 5).join(', ')}`);
  if (m.year) info.push(`Year: ${m.year}`);
  if (Array.isArray(m.tracks) && m.tracks.length) {
    info.push(`Tracks (${m.tracks.length}):\n` + m.tracks.slice(0, 8).map((t, i) => `${i + 1}. ${str(typeof t === 'string' ? t : t.title, 120)}`).join('\n'));
  }
  if (info.length) lines.push(info.join('\n'));
  const e = base(0x7c3aed, ev)
    .setTitle('💿 New HPSB Release')
    .setDescription(lines.join('\n\n').slice(0, 3800));
  const buttons = [];
  if (ev.url) buttons.push({ label: 'Open Release', url: ev.url });
  if (Array.isArray(m.services)) {
    for (const s of m.services.slice(0, 4)) {
      if (s?.url && /^https?:\/\//i.test(s.url)) {
        buttons.push({ label: str(s.label || s.type || 'Listen', 40), url: s.url });
      }
    }
  }
  return { embed: e, buttons };
}

function event(ev) {
  const m = ev.metadata || {};
  const lines = [linkedTitle(ev)];
  if (ev.description) lines.push(str(ev.description, 1500));
  const info = [];
  if (m.startAt) {
    const ts = Math.floor(new Date(m.startAt).getTime() / 1000);
    if (Number.isFinite(ts)) info.push(`When: <t:${ts}:F>`);
  }
  if (m.location) info.push(`Where: ${str(m.location, 150)}`);
  if (m.status) info.push(`Status: ${str(m.status, 100)}`);
  if (info.length) lines.push(info.join('\n'));
  const e = base(0x0ea5e9, ev)
    .setTitle('📅 New HPSB Event')
    .setDescription(lines.join('\n\n').slice(0, 3800));
  return { embed: e, buttons: ev.url ? [{ label: 'Open Event', url: ev.url }] : [] };
}

function news(ev) {
  const e = base(0x10b981, ev)
    .setTitle('📰 HPSB News')
    .setDescription(`${linkedTitle(ev)}\n${str(ev.description, 2000)}`.slice(0, 3800));
  return { embed: e, buttons: ev.url ? [{ label: 'Read more', url: ev.url }] : [] };
}

// Reminder variant: same event body, reminder title.
function reminder(ev, label) {
  const built = ev.source === 'hpsb' && ev.type === 'event' ? event(ev) : news(ev);
  built.embed.setTitle(`⏰ Reminder (${label}): ${str(ev.title || 'Event', 200)}`);
  return built;
}

function format(ev, opts = {}) {
  const s = String(ev?.source || '').toLowerCase();
  const t = String(ev?.type || '').toLowerCase();
  let out;
  if (s === 'twitch' && t === 'live') out = twitchLive(ev, opts.liveButtons || []);
  else if (s === 'hpsb' && t === 'release') out = release(ev);
  else if (s === 'hpsb' && t === 'event') out = event(ev);
  else if (s === 'hpsb') out = news(ev);
  else if (s === 'youtube') out = youtube(ev);
  else if (s === 'instagram') out = instagram(ev);
  else if (s === 'tiktok') out = tiktok(ev);
  else out = news(ev);
  const rows = linkButtonRows((out.buttons || []).slice(0, 8));
  return { embed: out.embed, components: rows };
}

module.exports = { format, reminder, youtube, instagram, tiktok, twitchLive, release, event, news };
