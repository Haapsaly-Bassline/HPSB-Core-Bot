// HPSB site-publisher: releases / events / posts.
// JSON первичен, RSS — фолбэк. Первый запуск только запоминает (без спама историей).
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { XMLParser } = require('fast-xml-parser');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');

const parser = new XMLParser({ ignoreAttributes: false });
let timer = null;

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
  await ch.send({ embeds: [embed] }).catch(() => {});
  return true;
}

// ---------- RELEASES ----------
async function fetchReleasesJson() {
  const { data } = await axios.get(config.hpsb.releases.apiUrl, { timeout: 15000 });
  const arr = Array.isArray(data) ? data : data.items || data.releases || [];
  return arr.filter(x => x?.id && x.status !== 'draft');
}

async function fetchReleasesRss() {
  const { data } = await axios.get(config.hpsb.releases.rssUrl, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
  });
  const feed = parser.parse(data);
  const items = Array.isArray(feed?.rss?.channel?.item) ? feed.rss.channel.item
    : feed?.rss?.channel?.item ? [feed.rss.channel.item] : [];
  return items.map(i => ({ rssGuid: String(i.guid?.['#text'] || i.guid || i.link), title: i.title, link: i.link, description: i.description }));
}

const SERVICE_LABEL = { bandcamp: 'Bandcamp', youtube: 'YouTube', 'youtube-music': 'YT Music', audiomack: 'Audiomack', soundcloud: 'SoundCloud', spotify: 'Spotify', discogs: 'Discogs', custom: 'More', merch: 'Merch' };

function releaseEmbed(r) {
  const base = config.hpsb.releases.pageBase || 'https://hpsbassline.club/releases';
  const page = `${base}/${r.slug || r.id}`;
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

async function checkReleases(client, state, opts = {}) {
  const { channelId } = config.hpsb.releases;
  if (!channelId) return { found: 0, posted: 0 };
  state.releases.ids = state.releases.ids || [];
  const known = new Set(state.releases.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const items = await fetchReleasesJson();
    if (!known.size && items.length && !backfill) {
      state.releases.ids = items.slice(0, 30).map(i => String(i.id));
      return { found: items.length, posted: 0 };
    }
    const targets = backfill ? items.slice(0, backfill) : items.filter(i => !known.has(String(i.id))).slice(0, 5);
    for (const r of targets) {
      await post(client, channelId, releaseEmbed(r));
      known.add(String(r.id));
      logger.info(`[hpsb/releases] posted ${r.slug || r.id}`);
    }
    state.releases.ids = [...known].slice(-100);
    return { found: items.length, posted: targets.length };
  } catch (e) {
    logger.warn('[hpsb/releases] json failed, trying rss:', e.message);
    try {
      const items = await fetchReleasesRss();
      if (!known.size && items.length) {
        state.releases.ids = items.slice(0, 30).map(i => i.rssGuid);
        return { found: items.length, posted: 0 };
      }
      const targets = items.filter(x => !known.has(x.rssGuid)).slice(0, 5);
      for (const i of targets) {
        await post(client, channelId, new EmbedBuilder()
          .setColor(0x7c3aed).setTitle(`💿 ${truncate(i.title, 250)}`).setURL(i.link)
          .setDescription(truncate(i.description || '', 1500)).setTimestamp()
          .setFooter({ text: 'Haapsaly Bassline • Release (RSS)' }));
        known.add(i.rssGuid);
      }
      state.releases.ids = [...known].slice(-100);
      return { found: items.length, posted: targets.length };
    } catch (e2) { logger.warn('[hpsb/releases] rss failed:', e2.message); return { found: 0, posted: 0 }; }
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

async function fetchEventsRss() {
  const { data } = await axios.get(config.hpsb.events.rssUrl, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
  });
  const feed = parser.parse(data);
  const items = Array.isArray(feed?.rss?.channel?.item) ? feed.rss.channel.item
    : feed?.rss?.channel?.item ? [feed.rss.channel.item] : [];
  return items.map(i => ({ rssGuid: String(i.guid?.['#text'] || i.guid || i.link), title: i.title, link: i.link, description: i.description, pubDate: i.pubDate }));
}

async function checkEvents(client, state, opts = {}) {
  const { channelId } = config.hpsb.events;
  if (!channelId) return { found: 0, posted: 0 };
  state.events.ids = state.events.ids || [];
  const known = new Set(state.events.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const { data } = await axios.get(config.hpsb.events.apiUrl, { timeout: 15000 });
    const items = Array.isArray(data) ? data : data.items || data.events || [];
    if (!known.size && items.length && !backfill) {
      state.events.ids = items.slice(0, 30).map(i => String(i.id));
      return { found: items.length, posted: 0 };
    }
    const targets = (backfill ? items.slice(0, backfill) : items.filter(i => i?.id && !known.has(String(i.id)))).slice(0, 5);
    for (const ev of targets) {
      await post(client, channelId, eventEmbed(ev));
      known.add(String(ev.id));
      logger.info(`[hpsb/events] posted ${ev.id}`);
    }
    state.events.ids = [...known].slice(-100);
    return { found: items.length, posted: targets.length };
  } catch (e) {
    logger.warn('[hpsb/events] json failed, trying rss:', e.message);
    try {
      const items = await fetchEventsRss();
      if (!known.size && items.length) {
        state.events.ids = items.slice(0, 30).map(i => i.rssGuid);
        return { found: items.length, posted: 0 };
      }
      const targets = items.filter(x => !known.has(x.rssGuid)).slice(0, 5);
      for (const i of targets) {
        await post(client, channelId, new EmbedBuilder()
          .setColor(0x0ea5e9).setTitle(`📅 ${truncate(i.title, 250)}`).setURL(i.link)
          .setDescription(truncate(i.description || '', 1800))
          .setTimestamp(i.pubDate ? new Date(i.pubDate) : new Date())
          .setFooter({ text: 'Haapsaly Bassline • Events (RSS)' }));
        known.add(i.rssGuid);
      }
      state.events.ids = [...known].slice(-100);
      return { found: items.length, posted: targets.length };
    } catch (e2) { logger.warn('[hpsb/events] rss failed:', e2.message); return { found: 0, posted: 0 }; }
  }
}

// ---------- Напоминания о будущих эвентах (24ч и 1ч до старта) ----------
async function checkReminders(client, state) {
  const { channelId } = config.hpsb.events;
  if (!channelId) return { found: 0, posted: 0 };
  state.events.reminded = state.events.reminded || {};
  let posted = 0, found = 0;
  try {
    const { data } = await axios.get(config.hpsb.events.apiUrl, { timeout: 15000 });
    const items = (Array.isArray(data) ? data : data.items || data.events || [])
      .filter(e => e?.id && e.start && (!e.status || e.status.code === 'upcoming'));
    found = items.length;
    const now = Date.now();
    for (const ev of items) {
      const t = new Date(ev.start).getTime();
      if (!t || t <= now) continue;
      const done = state.events.reminded[ev.id] || (state.events.reminded[ev.id] = []);
      const left = t - now;
      const need = left <= 3600 * 1000 ? '1h' : left <= 24 * 3600 * 1000 ? '24h' : null;
      if (need && !done.includes(need)) {
        const emb = eventEmbed(ev);
        emb.setTitle(`⏰ Напоминание (${need === '1h' ? 'остался час' : 'остались сутки'}): ${(ev.name || 'Event').slice(0, 200)}`);
        await post(client, channelId, emb);
        done.push(need);
        posted++;
        logger.info(`[hpsb/remind] ${ev.id} ${need}`);
      }
    }
  } catch (e) { logger.warn('[hpsb/remind]', e.message); }
  return { found, posted };
}

// ---------- POSTS ----------
async function checkPosts(client, state, opts = {}) {
  const { channelId, apiUrl } = { channelId: config.hpsb.posts.channelId, apiUrl: config.hpsb.posts.apiUrl };
  if (!channelId || !apiUrl) return { found: 0, posted: 0 };
  state.posts.ids = state.posts.ids || [];
  const known = new Set(state.posts.ids);
  const backfill = Math.min(Math.max(opts.backfill || 0, 0), 5);
  try {
    const { data } = await axios.get(apiUrl, { timeout: 15000 });
    const items = data.posts || data.items || (Array.isArray(data) ? data : []);
    if (!known.size && items.length && !backfill) {
      state.posts.ids = items.slice(0, 30).map(i => String(i.id || i.slug));
      return { found: items.length, posted: 0 };
    }
    const pool = backfill ? items.slice(0, backfill) : items.filter(i => (i.id || i.slug) && !known.has(String(i.id || i.slug)));
    const targets = pool.slice(0, 5);
    for (const p of targets) {
      const e = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle(`📰 ${truncate(p.title, 250)}`)
        .setURL(p.url || undefined)
        .setDescription(truncate(p.excerpt || p.description || '', 1800))
        .setTimestamp(p.publishedAt ? new Date(p.publishedAt) : new Date())
        .setFooter({ text: `Haapsaly Bassline • Post${p.tags?.length ? ' • ' + p.tags.join(', ') : ''}`.slice(0, 200) });
      if (p.cover) e.setImage(p.cover);
      await post(client, channelId, e);
      known.add(String(p.id || p.slug));
      logger.info(`[hpsb/posts] posted ${p.slug || p.id}`);
    }
    state.posts.ids = [...known].slice(-100);
    return { found: items.length, posted: targets.length };
  } catch (e) { logger.warn('[hpsb/posts]', e.message); return { found: 0, posted: 0 }; }
}

// ---------- legacy generic (SITE_API_URL) — оставлен для совместимости ----------
const { newsEmbed } = require('../../utils/embeds');
async function checkLegacy(client, state) {
  if (!config.siteApi.url || !config.siteApi.channelId) return { found: 0, posted: 0 };
  try {
    const { data } = await axios.get(config.siteApi.url, {
      timeout: 15000, headers: config.siteApi.key ? { Authorization: `Bearer ${config.siteApi.key}` } : {},
    });
    const items = Array.isArray(data) ? data : data.items || [];
    const known = new Set(state.site.lastIds || []);
    if (!known.size && items.length) {
      state.site.lastIds = items.slice(0, 30).map(i => String(i.id));
      return { found: items.length, posted: 0 };
    }
    const targets = items.filter(i => i?.id && !known.has(String(i.id))).slice(0, 5);
    for (const item of targets) {
      await post(client, config.siteApi.channelId, newsEmbed({ ...item, source: 'HPSB site' }));
      known.add(String(item.id));
    }
    state.site.lastIds = [...known].slice(-50);
    return { found: items.length, posted: targets.length };
  } catch (e) { logger.warn('[site legacy]', e.message); return { found: 0, posted: 0 }; }
}

const ZERO = { found: 0, posted: 0 };

// Один полный прогон (для поллера и для /sync). opts.backfill — докинуть последние N.
async function runHpsbOnce(client, opts = {}) {
  const state = store.load();
  const out = { releases: { ...ZERO }, events: { ...ZERO }, posts: { ...ZERO }, legacy: { ...ZERO }, reminders: { ...ZERO } };
  out.releases = await checkReleases(client, state, opts);
  out.events = await checkEvents(client, state, opts);
  out.posts = await checkPosts(client, state, opts);
  out.legacy = await checkLegacy(client, state);
  out.reminders = await checkReminders(client, state);
  store.save(state);
  return out;
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
