// Bandcamp fan collection: fan profile (bandcamp.com/<name>) -> purchased releases.
// Bandcamp embeds the first page of purchases in #pagedata's data-blob. Use that
// cache first; the collection_items API is only needed for items beyond the cache.
const { logger } = require('../../utils/logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FAN_RE = /^https?:\/\/(?:www\.)?bandcamp\.com\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;

async function fetchFanPage(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Fan page is unavailable: HTTP ${r.status}`);
  return r.text();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Parse the same page-data blob used by Bandcamp's own fan page. Do not parse
// the entire HTML with a fragile regex over the ordering of JSON properties.
function extractPageData(html) {
  const tag = String(html || '').match(/<div\b[^>]*\bid\s*=\s*(?:"pagedata"|'pagedata'|pagedata)[^>]*>/i);
  if (!tag) throw new Error('Bandcamp fan page has no #pagedata block (page layout may have changed)');
  const attr = tag[0].match(/\bdata-blob\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const raw = attr ? (attr[1] ?? attr[2]) : null;
  if (!raw) throw new Error('Bandcamp fan page has no data-blob');
  try {
    return JSON.parse(decodeHtmlEntities(raw));
  } catch (error) {
    throw new Error(`Could not parse Bandcamp fan page data: ${String(error?.message || error).slice(0, 140)}`);
  }
}

function parseFanData(data, fallbackUsername = '') {
  const f = data?.fan_data;
  const username = String(f?.username || fallbackUsername || '').trim();
  const fanId = Number(f?.fan_id);
  if (!username || !Number.isFinite(fanId) || fanId <= 0) {
    throw new Error('This is not a readable Bandcamp fan profile (missing fan_id/username; artist pages are not fan profiles)');
  }
  return { username, name: String(f?.name || username).trim() || username, fanId };
}

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function itemKind(item) {
  const raw = String(item?.tralbum_type || item?.url_hints?.item_type || item?.item_type || '').toLowerCase();
  if (raw === 't' || raw === 'track') return 'track';
  if (raw === 'a' || raw === 'album') return 'album';
  return null;
}

function canonicalItemUrl(item, kind) {
  const hints = item?.url_hints || {};
  const subdomain = String(hints.subdomain || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const slug = String(hints.slug || '').trim().replace(/^\/+|\/+$/g, '');
  if (subdomain && slug) {
    // Some payloads already provide "artist.bandcamp.com"; don't append the
    // domain suffix twice. Fan collection playback requires /track/ or /album/.
    const host = /\.bandcamp\.com$/i.test(subdomain) ? subdomain : `${subdomain}.bandcamp.com`;
    return `https://${host}/${kind}/${slug}`;
  }
  const rawUrl = String(item?.item_url || item?.url || '').trim();
  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl);
      if (/bandcamp\.com$/i.test(parsed.hostname)) return parsed.href;
    } catch {}
    // Custom artist domains are sometimes not supported by Lavalink's Bandcamp
    // resolver. If there's no canonical url_hints entry, retain the URL as given.
    return rawUrl;
  }
  return '';
}

function normalizeCollectionItem(item) {
  if (!item || typeof item !== 'object') return null;
  const kind = itemKind(item);
  if (!kind) return null;
  const url = canonicalItemUrl(item, kind);
  if (!url) return null;
  return {
    band: String(item.band_name || item.artist || ''),
    title: String(item.item_title || item.album_title || item.title || 'Unknown'),
    url,
    kind,
    tracks: Math.max(1, Number(item.num_streamable_tracks || item.track_count || 1) || 1),
    key: String(item.item_url || item.tralbum_id || item.item_id || url),
    token: item.token || null,
  };
}

async function fetchBatch(fanId, olderThanToken, count = 20) {
  const r = await fetch('https://bandcamp.com/api/fancollection/1/collection_items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Accept: 'application/json',
    },
    body: JSON.stringify({ fan_id: fanId, older_than_token: olderThanToken, count }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    const body = (await r.text().catch(() => '')).slice(0, 180);
    throw new Error(`Bandcamp collection API: HTTP ${r.status}${body ? ` — ${body}` : ''}`);
  }
  const data = await r.json();
  if (data?.error) {
    throw new Error(String(data.error_message || data.message || 'Bandcamp collection API returned an error').slice(0, 180));
  }
  if (!Array.isArray(data?.items)) {
    throw new Error('Bandcamp collection API returned an unexpected response (no items array)');
  }
  return data;
}

// Returns { fan, items, warning? }. limit counts albums/tracks, not the tracks
// inside each album. The first page cache often contains 45 items and needs no API.
async function fetchCollection(fanUrl, { limit = 10 } = {}) {
  const m = String(fanUrl || '').trim().match(FAN_RE);
  if (!m) throw new Error('Need a link like https://bandcamp.com/username (fan profile, not an artist)');
  const usernameFromUrl = m[1];
  const html = await fetchFanPage(`https://bandcamp.com/${usernameFromUrl}`);
  const data = extractPageData(html);
  const fan = parseFanData(data, usernameFromUrl);
  const collectionData = data.collection_data || {};
  const cache = valuesOf(data.item_cache?.collection);
  const maxItems = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));

  const items = [];
  const seen = new Set();
  const add = (raw) => {
    const item = normalizeCollectionItem(raw);
    if (!item || seen.has(item.key)) return;
    seen.add(item.key);
    items.push({ band: item.band, title: item.title, url: item.url, kind: item.kind, tracks: item.tracks });
  };

  // Critical: don't skip these releases. The page already embeds its initial
  // collection, while collection_items with last_token returns older releases.
  for (const item of cache) {
    add(item);
    if (items.length >= maxItems) break;
  }

  let warning = null;
  let olderThan = collectionData.last_token || cache.at(-1)?.token || null;
  const totalCount = Number(collectionData.item_count || data.collection_count || 0);
  const hasMore = !!olderThan && (collectionData.more_available === true || (totalCount > cache.length));
  while (items.length < maxItems && hasMore && olderThan) {
    let batch;
    try {
      // Use 20 rather than the remaining requested amount: collection_items has
      // historically returned an incorrect last_token when count is below 20.
      batch = await fetchBatch(fan.fanId, olderThan, 20);
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 200);
      logger.warn('[bandcamp-fan] collection pagination failed', detail);
      if (!items.length) throw new Error(detail);
      warning = `Only loaded ${items.length} visible release(s); Bandcamp could not provide the rest: ${detail}`;
      break;
    }
    if (!batch.items.length) {
      if (batch.more_available && !items.length) {
        throw new Error('Bandcamp says the collection has more items but returned an empty page');
      }
      break;
    }

    for (const item of batch.items) {
      add(item);
      if (items.length >= maxItems) break;
    }

    const lastItemToken = batch.items[batch.items.length - 1]?.token;
    const nextToken = lastItemToken || batch.last_token || null;
    if (!batch.more_available || !nextToken || nextToken === olderThan) break;
    olderThan = nextToken;
  }

  if (!items.length) {
    if (Number(data.collection_count || totalCount) === 0) {
      throw new Error('Bandcamp profile has no public collection releases (it may be empty or private)');
    }
    throw new Error('Bandcamp profile page contained no playable album/track URLs; its collection format may have changed');
  }
  if (items.length < maxItems && totalCount > items.length && !warning) {
    warning = `Loaded ${items.length} release(s) out of ${totalCount}; some collection items may be unavailable to the public profile.`;
  }
  logger.info?.('[bandcamp-fan] collection parsed', JSON.stringify({
    username: fan.username, pageCache: cache.length, selected: items.length, total: totalCount || null,
  }));
  return { fan, items, warning };
}

module.exports = {
  fetchCollection,
  FAN_RE,
  extractPageData,
  parseFanData,
  normalizeCollectionItem,
};
