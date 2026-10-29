// Bandcamp fan collection: fan profile (bandcamp.com/<name>, purchased) -> [{band, title, url, kind}].
// Page returns fan_id, then pagination via api/fancollection/1/collection_items.
// Upper limit set by caller (each album = separate load on node).
const { logger } = require('../../utils/logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FAN_RE = /^https?:\/\/(?:www\.)?bandcamp\.com\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;

async function fetchFanPage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Fan page is unavailable: HTTP ${r.status}`);
  // Bandcamp returns JSON inside HTML with HTML entities -- decode for regex parsing
  return (await r.text())
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&amp;/g, '&');
}

function parseFan(html) {
  const m = html.match(/"fan_data":\{"trackpipe_url":"[^"]*","username":"([^"]+)","name":"([^"]*)".*?"fan_id":(\d+)/);
  if (!m) throw new Error('This is not a fan profile (no fan_data: for artists use links like artist.bandcamp.com)');
  return { username: m[1], name: m[2] || m[1], fanId: Number(m[3]) };
}

async function fetchBatch(fanId, olderThanToken, count) {
  const r = await fetch('https://bandcamp.com/api/fancollection/1/collection_items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ fan_id: fanId, older_than_token: olderThanToken, count }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Bandcamp API: HTTP ${r.status}`);
  return r.json();
}

// Returns { fan: {username, name}, items: [{band, title, url, kind: 'album'|'track'}] }
async function fetchCollection(fanUrl, { limit = 10 } = {}) {
  const m = String(fanUrl || '').trim().match(FAN_RE);
  if (!m) throw new Error('Need a link like https://bandcamp.com/username (fan profile, not an artist)');
  const pageUrl = `https://bandcamp.com/${m[1]}`;
  const html = await fetchFanPage(pageUrl);
  const fan = parseFan(html);

  // last_token for first page sits in collection_data
  const tok = html.match(/"collection_data":\{"redownload_urls":\{\},"last_token":"([^"]+)"/);
  const decodeToken = (t) => String(t || '').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/');
  let olderThan = tok ? decodeToken(tok[1]) : null;

  const items = [];
  const seen = new Set();
  while (items.length < limit) {
    let batch;
    try {
      batch = await fetchBatch(fan.fanId, olderThan, Math.min(20, limit - items.length));
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 180);
      logger.warn('[bandcamp-fan] collection batch failed', detail);
      if (!items.length) throw new Error(`Bandcamp collection API request failed: ${detail}`);
      break; // Keep releases already fetched; the caller can still queue this partial batch.
    }
    if (!batch || !Array.isArray(batch.items) || !batch.items.length) break;
    for (const it of batch.items) {
      if (!it.item_url || seen.has(it.item_url)) continue;
      seen.add(it.item_url);
      // The collection API's tralbum_type is 't' for tracks and 'a' for albums.
      // Use it as the canonical type; url_hints.item_type may be absent or shaped differently.
      const kind = it.tralbum_type === 't' ? 'track' : it.tralbum_type === 'a' ? 'album' : null;
      if (!kind) {
        logger.warn('[bandcamp-fan] skipping item with unknown tralbum_type', String(it.tralbum_type), String(it.item_url || '').slice(0, 180));
        continue;
      }
      const uh = it.url_hints || {};
      const url = (uh.subdomain && uh.slug)
        ? `https://${uh.subdomain}.bandcamp.com/${kind}/${uh.slug}`
        : it.item_url;
      items.push({
        band: it.band_name || '',
        title: it.item_title || it.album_title || 'Unknown',
        url,
        kind,
        tracks: Number(it.num_streamable_tracks || 1),
      });
      if (items.length >= limit) break;
    }
    if (!batch.more_available) break;
    olderThan = decodeToken(batch.last_token);
    if (!olderThan) break;
  }
  if (!items.length) throw new Error('The collection is empty or private');
  return { fan, items };
}

module.exports = { fetchCollection, FAN_RE };