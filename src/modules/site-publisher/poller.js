// HPSB site-publisher: releases / events / posts + reminders.
// Principle: ONE source per feed (no JSON->RSS chains):
//   releases -> JSON releases API, events -> RSS (JSON dead), posts -> JSON.
// Format detected from response. Errors: backoff (3 failures = silent 30 min).
// First run only remembers (no history spam).
const axios = require('axios');
const { EmbedBuilder, ChannelType } = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');
const { newsEmbed } = require('../../utils/embeds');

const parser = new XMLParser({ ignoreAttributes: false });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let timer = null;

// fails: { key -> { n, until, warned } } -- backoff in memory
const fails = {};

function backoffSkip(key) {
  const f = fails[key];
  return f && f.until && Date.now() < f.until;
}

function backoffFail(key, err) {
  const f = fails[key] || (fails[key] = { n: 0, until: 0, warned: false });
  f.n++;
  if (f.n >= 3) {
    f.until = Date.now() + 30 * 60 * 1000;
    if (!f.warned) {
      f.warned = true;
      logger.warn(`[hpsb/${key}] 3 failures in a row (${err}) -- silent 30 min`);
    }
  } else {
    logger.warn(`[hpsb/${key}] fail ${f.n}/3: ${err}`);
  }
}

function backoffOk(key) {
  const f = fails[key];
  if (f && (f.n >= 2 || f.warned)) logger.info(`[hpsb/${key}] source revived after ${f.n} failure(s)`);
  delete fails[key];
}

function abs(base, maybeRelative) {
  if (!maybeRelative) return undefined;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return base + (maybeRelative.startsWith('/') ? '' : '/') + maybeRelative;
}

function truncate(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Invalid Date objects are truthy, so `x ? new Date(x) : new Date()` still
// throws RangeError inside setTimestamp(). This never throws.
function safeDate(v) {
  if (!v) return new Date();
  const t = new Date(v);
  return isNaN(t.getTime()) ? new Date() : t;
}

function guidStr(g) {
  if (g === null || g === undefined) return '';
  if (typeof g === 'string' || typeof g === 'number') return String(g);
  if (typeof g === 'object') return String(g['#text'] ?? g._text ?? g.content ?? '');
  return '';
}

function dateMs(item) {
  const t = item?.date ? new Date(item.date).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Target picker shared by all checks.
// Normal mode: unseen items (or backfill first N), capped at 5.
// Republish mode: already-known items, oldest first, capped at limit.
// Feeds are newest-first, so reverse to get oldest-first base order;
// valid dates then sort chronologically, undated keep that relative order.
function pickTargets(items, known, { backfill = 0, republish = 0 } = {}) {
  if (republish > 0) {
    return [...items].reverse()
      .map((item, ix) => ({ item, ix, t: dateMs(item) }))
      .filter(x => known.has(x.item.uid))
      .sort((a, b) => (a.t - b.t) || (a.ix - b.ix))
      .slice(0, Math.min(republish, 25))
      .map(x => x.item);
  }
  const list = backfill ? items.slice(0, backfill) : items.filter(i => !known.has(i.uid));
  return list.slice(0, 5);
}

// Source filter for /sync: opts.sources is null (all) or an array like ['releases','news'].
function skippedByFilter(opts, key) {
  return !!(opts?.sources && !opts.sources.includes(key));
}

// Embed URL setter that never throws: only real http(s) links, never undefined.
function setUrlSafe(embed, link) {
  if (/^https?:\/\//i.test(link || '')) embed.setURL(link);
  return embed;
}

async function post(client, channelId, embed, content) {
  if (!channelId) return false;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) { logger.warn('[hpsb] bad channel', channelId); return false; }
  const payload = content ? { content, embeds: [embed] } : { embeds: [embed] };
  const m = await ch.send(payload).catch((e) => {
    logger.warn('[hpsb] discord send failed', channelId, e?.message || e);
    return null;
  });
  if (!m) return false;
  // Announcement channels don't push to followers without an explicit publish.
  if (ch.type === ChannelType.GuildAnnouncement) {
    await m.crosspost().catch((e) => logger.warn('[hpsb] crosspost failed', channelId, e?.message || e));
  }
  return true;
}

function pingLine(text) {
  const { announcePing } = require('../../utils/embeds');
  const ping = announcePing();
  return ping ? `${ping} ${text}` : text;
}

// Single fetch per feed. Returns unified items:
// { uid, title, link, desc, date, image, raw }
async function fetchFeed(url) {
  const { data } = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
  if (typeof data === 'string' && /^\s*</.test(data)) {
    const feed = parser.parse(data);
    // RSS (rss.channel.item) and Atom (feed.entry) shapes
    const raw = feed?.rss?.channel?.item ?? feed?.feed?.entry ?? [];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.map(i => ({
      uid: guidStr(i.guid?.['#text'] ?? i.guid ?? i.id ?? i.link) || guidStr(i.link),
      title: i.title || '',
      link: typeof i.link === 'object' ? (i.link?.['@_href'] || i.link?.href || '') : (i.link || ''),
      desc: i.description || i.summary || '',
      date: i.pubDate || i.published || i.updated || '',
      image: i.enclosure?.url || i.enclosure?.['@_url'] || '',
      raw: i,
    })).filter(x => x.uid);
  }
  if (!data || typeof data !== 'object') return [];
  const arr = Array.isArray(data) ? data : data.data || data.posts || data.items || data.releases || data.events || [];
  if (!Array.isArray(arr)) return [];
  return arr.map(i => ({
    uid: String(i.id || i.slug || i.guid || ''),
    title: i.title || i.name || '', link: i.url || i.link || '',
    desc: i.description || i.excerpt || i.descriptionRaw || '',
    date: i.createdAt || i.publishedAt || i.start || i.pubDate || '',
    image: i.cover || i.image || '', raw: i,
  })).filter(x => x.uid);
}

// ---------- RELEASES ----------
const SERVICE_LABEL = { bandcamp: 'Bandcamp', youtube: 'YouTube', 'youtube-music': 'YT Music', audiomack: 'Audiomack', soundcloud: 'SoundCloud', spotify: 'Spotify', discogs: 'Discogs', custom: 'More', merch: 'Merch' };

function releaseEmbed(r) {
  const page = `${config.hpsb.releases.pageBase || 'https://hpsbassline.club/releases'}/${r.slug || r.id}`;
  const services = [...(r.services || [])];
  if (r.merch) services.push({ type: 'merch', url: r.merch });
  const links = services
    .filter(s => s?.url && /^https?:\/\//i.test(s.url))
    .slice(0, 10)
    .map(s => `[${SERVICE_LABEL[s.type] || s.type}](${s.url})`)
    .join(' • ');
  const e = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`💿 ${truncate(r.title, 200)} - ${truncate(r.artist || 'HPSB', 100)}`)
    .setURL(page)
    .setDescription(truncate(r.description || '', 1500) || '_New HPSB release_')
    .setTimestamp(safeDate(r.createdAt));
  const img = abs(config.hpsb.releases.baseUrl, r.cover);
  if (img) e.setImage(img);
  if (r.genre?.length) e.addFields({ name: 'Genre', value: r.genre.join(', ').slice(0, 200), inline: true });
  if (r.year) e.addFields({ name: 'Year', value: String(r.year), inline: true });
  if (r.tracks?.length) {
    e.addFields({ name: `Tracks (${r.tracks.length})`, value: truncate(r.tracks.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}`).join('\n'), 900) });
  }
  if (links) e.addFields({ name: 'Listen', value: truncate(links, 900) });
  e.setFooter({ text: 'Haapsaly Bassline • Release' });
  return e;
}

function simpleReleaseEmbed(item) {
  const e = new EmbedBuilder()
    .setColor(0x7c3aed).setTitle(`💿 ${truncate(item.title, 250)}`)
    .setDescription(truncate(item.desc, 1500)).setTimestamp(safeDate(item.date))
    .setFooter({ text: 'Haapsaly Bassline • Release' });
  return setUrlSafe(e, item.link);
}

async function checkReleases(client, state, opts = {}) {
  const KEY = 'releases';
  if (skippedByFilter(opts, 'releases')) return { found: 0, posted: 0, filtered: true };
  const { channelId, feedUrl } = config.hpsb.releases;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.releases.ids = state.releases.ids || [];
  const known = new Set(state.releases.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill && !opts.republish) {
      state.releases.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = pickTargets(items, known, { backfill, republish: opts.republish || 0 });
    let posted = 0;
    for (const item of targets) {
      const rich = item.raw?.services || item.raw?.tracks;
      const text = pingLine(`💿 New release: **${truncate(item.title, 200)}**`);
      if (await post(client, channelId, rich ? releaseEmbed(item.raw) : simpleReleaseEmbed(item), text)) {
        known.add(item.uid);
        posted++;
        logger.info(`[hpsb/releases] posted ${item.uid}`);
      }
    }
    state.releases.ids = [...known].slice(-100);
    return { found: items.length, posted };
  } catch (e) {
    backoffFail(KEY, e.message);
    return { found: 0, posted: 0 };
  }
}

// ---------- EVENTS ----------
// Strict date or null (for display rows -- garbage must not render as "now").
function dateOrNull(v) {
  if (!v) return null;
  const t = new Date(v);
  return isNaN(t.getTime()) ? null : t;
}

function eventEmbed(ev) {
  const start = dateOrNull(ev.start ?? ev.startUnix);
  const e = new EmbedBuilder()
    .setColor(0x0ea5e9)
    .setTitle(`📅 ${truncate(ev.name || 'Event', 250)}`)
    .setDescription(truncate(ev.description || ev.descriptionRaw || '', 1800))
    .setTimestamp(start || new Date());
  setUrlSafe(e, ev.link);
  if (ev.image) e.setImage(ev.image);
  const rows = [];
  if (start && !isNaN(start)) rows.push(`**When:** <t:${Math.floor(start.getTime() / 1000)}:F>`);
  if (ev.location) rows.push(`**Where:** ${truncate(ev.location, 150)}`);
  if (ev.status?.label) rows.push(`**Status:** ${ev.status.label}`);
  if (rows.length) e.addFields({ name: 'Details', value: rows.join('\n').slice(0, 900) });
  e.setFooter({ text: 'Haapsaly Bassline • Events' });
  return e;
}

function simpleEventEmbed(item) {
  const e = new EmbedBuilder()
    .setColor(0x0ea5e9).setTitle(`📅 ${truncate(item.title, 250)}`)
    .setDescription(truncate(item.desc, 1800))
    .setTimestamp(safeDate(item.date))
    .setFooter({ text: 'Haapsaly Bassline • Events' });
  return setUrlSafe(e, item.link);
}

function eventLike(ev) {
  // JSON variant with API fields
  if (ev && (ev.start || ev.startUnix)) {
    return { name: ev.name, link: ev.link, description: ev.description || ev.descriptionRaw, image: ev.image, location: ev.location, status: ev.status, start: ev.start, startUnix: ev.startUnix };
  }
  return null;
}

async function checkEvents(client, state, opts = {}) {
  const KEY = 'events';
  if (skippedByFilter(opts, 'events')) return { found: 0, posted: 0, filtered: true };
  const { channelId, feedUrl } = config.hpsb.events;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.events.ids = state.events.ids || [];
  const known = new Set(state.events.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill && !opts.republish) {
      state.events.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = pickTargets(items, known, { backfill, republish: opts.republish || 0 });
    let posted = 0;
    for (const item of targets) {
      const rich = eventLike(item.raw);
      const emb = rich ? eventEmbed({ ...rich, link: rich.link || item.link }) : simpleEventEmbed(item);
      const text = pingLine(`📅 New event: **${truncate(item.title, 200)}**`);
      if (await post(client, channelId, emb, text)) {
        known.add(item.uid);
        posted++;
        logger.info(`[hpsb/events] posted ${item.uid}`);
      }
    }
    state.events.ids = [...known].slice(-100);
    return { found: items.length, posted };
  } catch (e) {
    backoffFail(KEY, e.message);
    return { found: 0, posted: 0 };
  }
}

// ---------- Future event reminders (24h and 1h before start) ----------
// ONLY from a real start field (raw.start/startUnix/startDate). RSS pubDate is
// publish time (always past) -- using it would silently never fire.
async function checkReminders(client, state) {
  const KEY = 'events'; // same feed+URL as checkEvents: shared backoff counter
  const { channelId, feedUrl } = config.hpsb.events;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.events.reminded = (state.events.reminded && typeof state.events.reminded === 'object') ? state.events.reminded : {};
  let posted = 0, found = 0, noStart = 0;
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    found = items.length;
    const now = Date.now();
    const seen = new Set();
    for (const item of items) {
      seen.add(item.uid);
      const raw = item.raw || {};
      const startMs = dateOrNull(raw.start ?? raw.startUnix ?? raw.startDate)?.getTime() || 0;
      if (!startMs) { noStart++; continue; }
      if (startMs <= now) continue;
      const done = state.events.reminded[item.uid] || (state.events.reminded[item.uid] = []);
      const left = startMs - now;
      // all due tiers, oldest first (a downtime crossing 24h->1h must not skip the 24h notice)
      const due = [];
      if (left <= 24 * 3600 * 1000 && !done.includes('24h')) due.push('24h');
      if (left <= 3600 * 1000 && !done.includes('1h')) due.push('1h');
      for (const need of due) {
        const rich = eventLike(item.raw);
        const emb = rich ? eventEmbed({ ...rich, link: rich.link || item.link }) : simpleEventEmbed(item);
        emb.setTitle(`⏰ Reminder (${need === '1h' ? '1 hour left' : '24 hours left'}): ${truncate(item.title || 'Event', 200)}`);
        const text = pingLine(`⏰ Reminder: **${truncate(item.title, 200)}**`);
        if (await post(client, channelId, emb, text)) {
          done.push(need);
          posted++;
          logger.info(`[hpsb/remind] ${item.uid} ${need}`);
        }
      }
    }
    // prune: past events and uids gone from the feed (unbounded growth otherwise)
    for (const uid of Object.keys(state.events.reminded)) {
      if (!seen.has(uid)) delete state.events.reminded[uid];
    }
    if (noStart) logger.info(`[hpsb/remind] ${noStart} item(s) without a start field -- reminders need raw.start/startUnix (RSS pubDate is publish time, not start)`);
  } catch (e) {
    backoffFail(KEY, e.message);
  }
  return { found, posted };
}

// ---------- POSTS ----------
async function checkPosts(client, state, opts = {}) {
  const KEY = 'posts';
  if (skippedByFilter(opts, 'news')) return { found: 0, posted: 0, filtered: true };
  const { channelId, apiUrl } = { channelId: config.hpsb.posts.channelId, apiUrl: config.hpsb.posts.apiUrl };
  if (!channelId || !apiUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.posts.ids = state.posts.ids || [];
  const known = new Set(state.posts.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(apiUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill && !opts.republish) {
      state.posts.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = pickTargets(items, known, { backfill, republish: opts.republish || 0 });
    let posted = 0;
    for (const item of targets) {
      const p = item.raw || {};
      const e = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle(`📰 ${truncate(item.title, 250)}`)
        .setDescription(truncate(item.desc, 1800))
        .setTimestamp(safeDate(item.date))
        .setFooter({ text: `Haapsaly Bassline • Post${p.tags?.length ? ' • ' + p.tags.join(', ') : ''}`.slice(0, 200) });
      setUrlSafe(e, item.link);
      if (item.image) e.setImage(item.image);
      const text = pingLine(`📰 **${truncate(item.title, 200)}**`);
      if (await post(client, channelId, e, text)) {
        known.add(item.uid);
        posted++;
        logger.info(`[hpsb/posts] posted ${item.uid}`);
      }
    }
    state.posts.ids = [...known].slice(-100);
    return { found: items.length, posted };
  } catch (e) {
    backoffFail(KEY, e.message);
    return { found: 0, posted: 0 };
  }
}

// ---------- legacy generic (SITE_API_URL) ----------
async function checkLegacy(client, state) {
  const KEY = 'legacy';
  if (!config.siteApi.url || !config.siteApi.channelId) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  try {
    const { data } = await axios.get(config.siteApi.url, {
      timeout: 20000, headers: { ...(config.siteApi.key ? { Authorization: `Bearer ${config.siteApi.key}` } : {}), 'User-Agent': UA },
    });
    const items = Array.isArray(data) ? data : data.items || [];
    backoffOk(KEY);
    const known = new Set(state.site.lastIds || []);
    if (!known.size && items.length) {
      state.site.lastIds = items.slice(0, 30).map(i => String(i.id));
      return { found: items.length, posted: 0 };
    }
    const targets = items.filter(i => i?.id && !known.has(String(i.id))).slice(0, 5);
    let posted = 0;
    for (const item of targets) {
      const text = pingLine(`📰 **${truncate(item.title || 'News', 200)}**`);
      if (await post(client, config.siteApi.channelId, newsEmbed({ ...item, source: 'HPSB site' }), text)) {
        known.add(String(item.id));
        posted++;
      }
    }
    state.site.lastIds = [...known].slice(-50);
    return { found: items.length, posted };
  } catch (e) {
    backoffFail(KEY, e.message);
    return { found: 0, posted: 0 };
  }
}

const ZERO = { found: 0, posted: 0 };
let running = false;

// One full run (for poller and for /sync). opts.backfill -- add last N.
// Serialized via store mutex: the webhook does its own load/save mid-poll,
// interleaved runs would overwrite each other's posted IDs (dupes).
async function runHpsbOnce(client, opts = {}) {
  if (running) { logger.warn('[hpsb] previous run still active, skipping'); return { skipped: true }; }
  running = true;
  try {
    return await store.exclusive(async () => {
      const state = store.load();
      const out = { releases: { ...ZERO }, events: { ...ZERO }, posts: { ...ZERO }, legacy: { ...ZERO }, reminders: { ...ZERO } };
      out.releases = await checkReleases(client, state, opts);
      out.events = await checkEvents(client, state, opts);
      out.posts = await checkPosts(client, state, opts);
      out.legacy = await checkLegacy(client, state);
      out.reminders = await checkReminders(client, state);
      store.save(state);
      return out;
    });
  } finally {
    running = false;
  }
}

function pollMinutes() {
  const mins = Number(config.hpsb.pollMinutes);
  return Number.isFinite(mins) ? Math.max(1, mins) : 5;
}

function startSitePoller(client) {
  const mins = pollMinutes();
  const anyChannel = config.hpsb.releases.channelId || config.hpsb.events.channelId || config.hpsb.posts.channelId || config.siteApi.channelId;
  if (!anyChannel) {
    logger.info('[hpsb] skipped (no *_CHANNEL_ID set)');
    return;
  }
  const run = () => runHpsbOnce(client);
  run().catch(e => logger.warn('[hpsb]', e.message));
  if (timer) clearInterval(timer);
  timer = setInterval(() => run().catch(e => logger.warn('[hpsb]', e.message)), mins * 60 * 1000);
  timer.unref?.();
  logger.info(`[hpsb] polling releases/events/posts every ${mins}m`);
}

module.exports = { startSitePoller, runHpsbOnce, pickTargets, skippedByFilter, dateMs, guidStr, safeDate };
