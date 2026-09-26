// HPSB site-publisher: releases / events / posts + напоминания.
// Принцип: ОДИН источник на ленту (без цепочек JSON->RSS):
//   releases -> JSON releases API, events -> RSS (JSON мёртв), posts -> JSON.
// Формат определяется по ответу. Ошибки: бэкофф (3 провала = молчим 30 мин).
// Первый запуск только запоминает (без спама историей).
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');
const { newsEmbed } = require('../../utils/embeds');

const parser = new XMLParser({ ignoreAttributes: false });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let timer = null;

// fails: { key -> { n, until, warned } } — бэкофф в памяти
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
      logger.warn(`[hpsb/${key}] 3 провала подряд (${err}) — молчу 30 мин`);
    }
  } else {
    logger.warn(`[hpsb/${key}] fail ${f.n}/3: ${err}`);
  }
}

function backoffOk(key) {
  const f = fails[key];
  if (f && (f.n > 0 || f.warned)) logger.info(`[hpsb/${key}] источник ожил`);
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

async function post(client, channelId, embed) {
  if (!channelId) return false;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) { logger.warn('[hpsb] bad channel', channelId); return false; }
  return ch.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

// Один fetch на ленту. Возвращает унифицированные items:
// { uid, title, link, desc, date, image, raw }
async function fetchFeed(url) {
  const { data } = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': UA } });
  if (typeof data === 'string' && /^\s*</.test(data)) {
    const feed = parser.parse(data);
    const raw = feed?.rss?.channel?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.map(i => ({
      uid: String(i.guid?.['#text'] || i.guid || i.link || ''),
      title: i.title || '', link: i.link || '', desc: i.description || '',
      date: i.pubDate || '', image: i.enclosure?.url || '', raw: i,
    })).filter(x => x.uid);
  }
  const arr = Array.isArray(data) ? data : data.posts || data.items || data.releases || data.events || [];
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
  const links = services.slice(0, 10).map(s => `[${SERVICE_LABEL[s.type] || s.type}](${s.url})`).join(' • ');
  const e = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`💿 ${truncate(r.title, 200)} — ${truncate(r.artist || 'HPSB', 100)}`)
    .setURL(page)
    .setDescription(truncate(r.description || '', 1500) || '_Новый релиз HPSB_')
    .setTimestamp(r.createdAt ? new Date(r.createdAt) : new Date());
  const img = abs(config.hpsb.releases.baseUrl, r.cover);
  if (img) e.setImage(img);
  if (r.genre?.length) e.addFields({ name: 'Жанр', value: r.genre.join(', ').slice(0, 200), inline: true });
  if (r.year) e.addFields({ name: 'Год', value: String(r.year), inline: true });
  if (r.tracks?.length) {
    e.addFields({ name: `Треки (${r.tracks.length})`, value: truncate(r.tracks.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}`).join('\n'), 900) });
  }
  if (links) e.addFields({ name: 'Слушать', value: truncate(links, 900) });
  e.setFooter({ text: 'Haapsaly Bassline • Release' });
  return e;
}

function simpleReleaseEmbed(item) {
  return new EmbedBuilder()
    .setColor(0x7c3aed).setTitle(`💿 ${truncate(item.title, 250)}`).setURL(item.link || undefined)
    .setDescription(truncate(item.desc, 1500)).setTimestamp(item.date ? new Date(item.date) : new Date())
    .setFooter({ text: 'Haapsaly Bassline • Release' });
}

async function checkReleases(client, state, opts = {}) {
  const KEY = 'releases';
  const { channelId, feedUrl } = config.hpsb.releases;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.releases.ids = state.releases.ids || [];
  const known = new Set(state.releases.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill) {
      state.releases.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = (backfill ? items.slice(0, backfill) : items.filter(i => !known.has(i.uid))).slice(0, 5);
    let posted = 0;
    for (const item of targets) {
      const rich = item.raw?.services || item.raw?.tracks;
      if (await post(client, channelId, rich ? releaseEmbed(item.raw) : simpleReleaseEmbed(item))) {
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
function eventEmbed(ev) {
  const start = ev.start ? new Date(ev.start) : ev.startUnix ? new Date(ev.startUnix) : null;
  const e = new EmbedBuilder()
    .setColor(0x0ea5e9)
    .setTitle(`📅 ${truncate(ev.name || 'Event', 250)}`)
    .setURL(ev.link || undefined)
    .setDescription(truncate(ev.description || ev.descriptionRaw || '', 1800))
    .setTimestamp(start || new Date());
  if (ev.image) e.setImage(ev.image);
  const rows = [];
  if (start && !isNaN(start)) rows.push(`**Когда:** <t:${Math.floor(start.getTime() / 1000)}:F>`);
  if (ev.location) rows.push(`**Где:** ${truncate(ev.location, 150)}`);
  if (ev.status?.label) rows.push(`**Статус:** ${ev.status.label}`);
  if (rows.length) e.addFields({ name: 'Детали', value: rows.join('\n').slice(0, 900) });
  e.setFooter({ text: 'Haapsaly Bassline • Events' });
  return e;
}

function simpleEventEmbed(item) {
  return new EmbedBuilder()
    .setColor(0x0ea5e9).setTitle(`📅 ${truncate(item.title, 250)}`).setURL(item.link || undefined)
    .setDescription(truncate(item.desc, 1800))
    .setTimestamp(item.date ? new Date(item.date) : new Date())
    .setFooter({ text: 'Haapsaly Bassline • Events' });
}

function eventLike(ev) {
  // JSON-вариант с полями API
  if (ev && (ev.start || ev.startUnix)) {
    return { name: ev.name, link: ev.link, description: ev.description || ev.descriptionRaw, image: ev.image, location: ev.location, status: ev.status, start: ev.start, startUnix: ev.startUnix };
  }
  return null;
}

async function checkEvents(client, state, opts = {}) {
  const KEY = 'events';
  const { channelId, feedUrl } = config.hpsb.events;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.events.ids = state.events.ids || [];
  const known = new Set(state.events.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill) {
      state.events.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = (backfill ? items.slice(0, backfill) : items.filter(i => !known.has(i.uid))).slice(0, 5);
    let posted = 0;
    for (const item of targets) {
      const rich = eventLike(item.raw);
      const emb = rich ? eventEmbed({ ...rich, link: rich.link || item.link }) : simpleEventEmbed(item);
      if (await post(client, channelId, emb)) {
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

// ---------- Напоминания о будущих эвентах (24ч и 1ч до старта) ----------
// Старт берём из date (RSS pubDate = старт, JSON start).
async function checkReminders(client, state) {
  const KEY = 'remind';
  const { channelId, feedUrl } = config.hpsb.events;
  if (!channelId || !feedUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.events.reminded = state.events.reminded || {};
  let posted = 0, found = 0;
  try {
    const items = await fetchFeed(feedUrl);
    backoffOk(KEY);
    found = items.length;
    const now = Date.now();
    for (const item of items) {
      const t = item.date ? new Date(item.date).getTime() : 0;
      if (!t || t <= now) continue;
      const done = state.events.reminded[item.uid] || (state.events.reminded[item.uid] = []);
      const left = t - now;
      const need = left <= 3600 * 1000 ? '1h' : left <= 24 * 3600 * 1000 ? '24h' : null;
      if (need && !done.includes(need)) {
        const rich = eventLike(item.raw);
        const emb = rich ? eventEmbed({ ...rich, link: rich.link || item.link }) : simpleEventEmbed(item);
        emb.setTitle(`⏰ Напоминание (${need === '1h' ? 'остался час' : 'остались сутки'}): ${truncate(item.title || 'Event', 200)}`);
        if (await post(client, channelId, emb)) {
          done.push(need);
          posted++;
          logger.info(`[hpsb/remind] ${item.uid} ${need}`);
        }
      }
    }
  } catch (e) {
    backoffFail(KEY, e.message);
  }
  return { found, posted };
}

// ---------- POSTS ----------
async function checkPosts(client, state, opts = {}) {
  const KEY = 'posts';
  const { channelId, apiUrl } = { channelId: config.hpsb.posts.channelId, apiUrl: config.hpsb.posts.apiUrl };
  if (!channelId || !apiUrl) return { found: 0, posted: 0 };
  if (backoffSkip(KEY)) return { found: 0, posted: 0 };
  state.posts.ids = state.posts.ids || [];
  const known = new Set(state.posts.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchFeed(apiUrl);
    backoffOk(KEY);
    if (!known.size && items.length && !backfill) {
      state.posts.ids = items.slice(0, 30).map(i => i.uid);
      return { found: items.length, posted: 0 };
    }
    const targets = (backfill ? items.slice(0, backfill) : items.filter(i => !known.has(i.uid))).slice(0, 5);
    let posted = 0;
    for (const item of targets) {
      const p = item.raw || {};
      const e = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle(`📰 ${truncate(item.title, 250)}`)
        .setURL(item.link || undefined)
        .setDescription(truncate(item.desc, 1800))
        .setTimestamp(item.date ? new Date(item.date) : new Date())
        .setFooter({ text: `Haapsaly Bassline • Post${p.tags?.length ? ' • ' + p.tags.join(', ') : ''}`.slice(0, 200) });
      if (item.image) e.setImage(item.image);
      if (await post(client, channelId, e)) {
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
      if (await post(client, config.siteApi.channelId, newsEmbed({ ...item, source: 'HPSB site' }))) {
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

// Один полный прогон (для поллера и для /sync). opts.backfill — докинуть последние N.
async function runHpsbOnce(client, opts = {}) {
  if (running) { logger.warn('[hpsb] previous run still active, skipping'); return null; }
  running = true;
  try {
    const state = store.load();
    const out = { releases: { ...ZERO }, events: { ...ZERO }, posts: { ...ZERO }, legacy: { ...ZERO }, reminders: { ...ZERO } };
    out.releases = await checkReleases(client, state, opts);
    out.events = await checkEvents(client, state, opts);
    out.posts = await checkPosts(client, state, opts);
    out.legacy = await checkLegacy(client, state);
    out.reminders = await checkReminders(client, state);
    store.save(state);
    return out;
  } finally {
    running = false;
  }
}

function startSitePoller(client) {
  const mins = Math.max(1, config.hpsb.pollMinutes || 5);
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

module.exports = { startSitePoller, runHpsbOnce };
