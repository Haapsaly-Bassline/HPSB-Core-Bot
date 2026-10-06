// HPSB internal source: events / releases / news.
// Priority: EVENTS API -> RSS fallback; RELEASES API -> RSS fallback; NEWS RSS.
// One fetch per feed (no parallel API+RSS publishing) -- shared dedup keys
// guarantee API and RSS can never double-post the same item.
const { fetchWithFallback, dateMs, truncate } = require('./fetch');
const { logger } = require('../../../utils/logger');

const SERVICE_LABEL = {
  bandcamp: 'Bandcamp', youtube: 'YouTube', 'youtube-music': 'YT Music',
  audiomack: 'Audiomack', soundcloud: 'SoundCloud', spotify: 'Spotify',
  discogs: 'Discogs', custom: 'More', merch: 'Merch',
};

function abs(base, maybeRelative) {
  if (!maybeRelative) return '';
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return (base || '').replace(/\/$/, '') + (String(maybeRelative).startsWith('/') ? '' : '/') + maybeRelative;
}

function normalizeRelease(item, cfg = {}) {
  const r = item.raw || {};
  const pageBase = (cfg?.hpsb?.releases?.pageBase || 'https://hpsbassline.club/releases').replace(/\/$/, '');
  const baseUrl = cfg?.hpsb?.releases?.baseUrl || 'https://release.hpsbassline.club';
  const page = `${pageBase}/${r.slug || r.id || item.uid}`;
  const services = [...(r.services || [])];
  if (r.merch) services.push({ type: 'merch', url: r.merch });
  return {
    source: 'hpsb',
    type: 'release',
    id: String(item.uid),
    author: r.artist || 'HPSB',
    title: item.title || 'Release',
    description: truncate(item.desc, 1200),
    url: /^https?:\/\//i.test(item.link || '') ? item.link : page,
    image: abs(baseUrl, r.cover || item.image),
    publishedAt: item.date || '',
    target: 'announcements',
    metadata: {
      artist: r.artist || '',
      genre: Array.isArray(r.genre) ? r.genre : [],
      year: r.year || null,
      tracks: Array.isArray(r.tracks) ? r.tracks : [],
      services: services.filter((s) => s?.url && /^https?:\/\//i.test(s.url)).map((s) => ({
        label: SERVICE_LABEL[s.type] || s.type || 'Listen', url: s.url,
      })),
      merch: r.merch || '',
    },
  };
}

function normalizeEvent(item, cfg = {}) {
  const r = item.raw || {};
  const pageBase = (cfg?.hpsb?.events?.pageBase || 'https://hpsbassline.club/events').replace(/\/$/, '');
  const page = `${pageBase}/${r.slug || r.id || item.uid}`;
  const start = r.start ?? r.startUnix ?? r.startDate ?? '';
  return {
    source: 'hpsb',
    type: 'event',
    id: String(item.uid),
    author: 'HPSB',
    title: r.name || item.title || 'Event',
    description: truncate(item.desc || r.description || r.descriptionRaw || '', 1500),
    url: /^https?:\/\//i.test(item.link || '') ? item.link : page,
    image: item.image || r.image || '',
    publishedAt: item.date || '',
    target: 'announcements',
    metadata: {
      location: r.location || '',
      status: r.status?.label || r.status || '',
      startAt: start ? new Date(start).toISOString?.() || String(start) : '',
      startMs: typeof start === 'number' ? start * 1000 : dateMs(start),
    },
  };
}

function normalizeNews(item) {
  const r = item.raw || {};
  const tags = Array.isArray(r.tags) ? r.tags : [];
  return {
    source: 'hpsb',
    type: 'news',
    id: String(item.uid),
    author: 'HPSB',
    title: item.title || 'News',
    description: truncate(item.desc, 1800),
    url: item.link || '',
    image: item.image || '',
    publishedAt: item.date || '',
    target: 'announcements',
    metadata: { tags },
  };
}

async function fetchEvents(cfg = {}, { http } = {}) {
  const h = cfg?.publisher?.hpsb || {};
  const { items, via, note } = await fetchWithFallback(h.eventsApiUrl, h.eventsRssUrl, { http });
  return { events: items.map((i) => normalizeEvent(i, cfg)), via, note };
}

async function fetchReleases(cfg = {}, { http } = {}) {
  const h = cfg?.publisher?.hpsb || {};
  const { items, via, note } = await fetchWithFallback(h.releasesApiUrl, h.releasesRssUrl, { http });
  return { events: items.map((i) => normalizeRelease(i, cfg)), via, note };
}

async function fetchNews(cfg = {}, { http } = {}) {
  const h = cfg?.publisher?.hpsb || {};
  const { items, via, note } = await fetchWithFallback(h.newsRssUrl, null, { http });
  return { events: items.map(normalizeNews), via: via === 'api' ? 'rss' : via, note };
}

// Reminder scan: needs a REAL start field (raw.start/startUnix/startDate).
// RSS pubDate is publish time (always past) and must never trigger reminders.
function dueReminders(items, reminded, now = Date.now()) {
  const due = [];
  let noStart = 0;
  for (const ev of items) {
    const startMs = ev?.metadata?.startMs || 0;
    if (!startMs || startMs <= now) { if (!startMs) noStart++; continue; }
    const done = reminded[ev.id] || [];
    const left = startMs - now;
    // Both tiers are independent: an event created <1h before start still
    // owes the 24h notice first (a downtime crossing 24h->1h must not skip it).
    if (left <= 24 * 3600 * 1000 && !done.includes('24h')) due.push({ ev, tier: '24h' });
    if (left <= 3600 * 1000 && !done.includes('1h')) due.push({ ev, tier: '1h' });
  }
  return { due, noStart };
}

async function fetchHpsb(cfg = {}, { http } = {}) {
  const [evRes, relRes, newsRes] = await Promise.all([
    fetchEvents(cfg, { http }).catch((e) => { logger.warn(`[publisher/hpsb] events: ${e.message}`); return { events: [], via: 'none', note: e.message }; }),
    fetchReleases(cfg, { http }).catch((e) => { logger.warn(`[publisher/hpsb] releases: ${e.message}`); return { events: [], via: 'none', note: e.message }; }),
    fetchNews(cfg, { http }).catch((e) => { logger.warn(`[publisher/hpsb] news: ${e.message}`); return { events: [], via: 'none', note: e.message }; }),
  ]);
  const sortOld = (arr) => arr.sort((a, b) => (dateMs(a.publishedAt) - dateMs(b.publishedAt)));
  return {
    releases: sortOld(relRes.events),
    events: sortOld(evRes.events),
    news: sortOld(newsRes.events),
    via: { releases: relRes.via, events: evRes.via, news: newsRes.via },
    notes: { releases: relRes.note || '', events: evRes.note || '', news: newsRes.note || '' },
  };
}

module.exports = {
  fetchHpsb, fetchEvents, fetchReleases, fetchNews,
  normalizeRelease, normalizeEvent, normalizeNews, dueReminders, SERVICE_LABEL,
};
