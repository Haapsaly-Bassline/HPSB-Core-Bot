// Shared fetch helpers for Publisher sources.
// Tolerant parsing: upstream may be JSON (object/array/nested) or RSS/Atom XML.
// Adapters never throw on weird payloads -- they return [] and let the caller log.
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const parser = new XMLParser({ ignoreAttributes: false });

function guidStr(g) {
  if (g === null || g === undefined) return '';
  if (typeof g === 'string' || typeof g === 'number') return String(g);
  if (typeof g === 'object') return String(g['#text'] ?? g._text ?? g.content ?? '');
  return '';
}

// Unified feed item: { uid, title, link, desc, date, image, raw }.
// Accepts parsed JSON (any nesting) or raw XML string.
function toItems(data) {
  if (typeof data === 'string' && /^\s*</.test(data)) {
    const feed = parser.parse(data);
    const raw = feed?.rss?.channel?.item ?? feed?.feed?.entry ?? [];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return items.map((i) => ({
      uid: guidStr(i.guid?.['#text'] ?? i.guid ?? i.id ?? i.link) || guidStr(i.link),
      title: i.title || '',
      link: typeof i.link === 'object' ? (i.link?.['@_href'] || i.link?.href || '') : (i.link || ''),
      desc: i.description || i.summary || '',
      date: i.pubDate || i.published || i.updated || '',
      image: i.enclosure?.url || i.enclosure?.['@_url'] || '',
      raw: i,
    })).filter((x) => x.uid);
  }
  if (!data || typeof data !== 'object') return [];
  const arr = Array.isArray(data) ? data : data.data || data.posts || data.items || data.releases || data.events || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((i) => ({
    uid: String(i.id || i.slug || i.guid || ''),
    title: i.title || i.name || '',
    link: i.url || i.link || '',
    desc: i.description || i.excerpt || i.descriptionRaw || '',
    date: i.createdAt || i.publishedAt || i.start || i.pubDate || '',
    image: i.cover || i.image || '',
    raw: i,
  })).filter((x) => x.uid);
}

async function get(url, { http, timeout = 20000, headers } = {}) {
  const client = http || axios;
  const res = await client.get(url, { timeout, headers: { 'User-Agent': UA, ...(headers || {}) } });
  return res?.data;
}

// Fetch one URL and normalize to unified items. Never throws -- returns [] on error.
async function fetchFeed(url, opts = {}) {
  try {
    if (!url) return [];
    return toItems(await get(url, opts));
  } catch {
    return [];
  }
}

// Fetch primary, fall back to secondary when primary errors OR returns empty.
// Returns { items, via: 'api'|'rss'|'none' }.
async function fetchWithFallback(primaryUrl, fallbackUrl, opts = {}) {
  if (primaryUrl) {
    try {
      const items = toItems(await get(primaryUrl, opts));
      if (items.length) return { items, via: 'api' };
    } catch {
      // fall through to RSS
    }
  }
  if (fallbackUrl) {
    try {
      const items = toItems(await get(fallbackUrl, opts));
      if (items.length) return { items, via: 'rss' };
    } catch {
      // none available
    }
  }
  return { items: [], via: 'none' };
}

function dateMs(v) {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Oldest-first ordering for (re)publish: valid dates chronological,
// undated keep feed-relative order. Mirrors legacy pickTargets semantics.
function oldestFirst(items, key = 'date') {
  return [...items]
    .map((item, ix) => ({ item, ix, t: dateMs(item[key]) }))
    .sort((a, b) => {
      if (a.t && b.t) return (a.t - b.t) || (a.ix - b.ix);
      if (a.t) return -1;
      if (b.t) return 1;
      return a.ix - b.ix;
    })
    .map((x) => x.item);
}

function truncate(s, n) {
  if (s === null || s === undefined) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { UA, get, toItems, fetchFeed, fetchWithFallback, dateMs, oldestFirst, truncate };
