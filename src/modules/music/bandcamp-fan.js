// Bandcamp fan-коллекция: fan-профиль (bandcamp.com/<name>, купленное) -> [{band, title, url, kind}].
// Страница отдаёт fan_id, дальше пагинация через api/fancollection/1/collection_items.
// Ограничение сверху задаёт вызывающий (каждый альбом — отдельный load у ноды).
const { logger } = require('../../utils/logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const FAN_RE = /^https?:\/\/(?:www\.)?bandcamp\.com\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i;

async function fetchFanPage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Fan-страница недоступна: HTTP ${r.status}`);
  // Bandcamp отдаёт JSON внутри HTML с &quot;-сущностями — декодируем для regex-парсинга
  return (await r.text()).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function parseFan(html, url) {
  const m = html.match(/"fan_data":\{"trackpipe_url":"[^"]*","username":"([^"]+)","name":"([^"]*)".*?"fan_id":(\d+)/);
  if (!m) throw new Error('Это не fan-профиль (нет fan_data: для артистов — ссылки вида artist.bandcamp.com)');
  return { username: m[1], name: m[2] || m[1], fanId: Number(m[3]) };
}

async function fetchBatch(fanId, olderThanToken, count) {
  const r = await fetch('https://bandcamp.com/api/fancollection/1/collection_items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ fan_id: fanId, older_than_token: olderThanToken, count }),
  });
  if (!r.ok) throw new Error(`Bandcamp API: HTTP ${r.status}`);
  return r.json();
}

// Возвращает { fan: {username, name}, items: [{band, title, url, kind: 'album'|'track'}] }
async function fetchCollection(fanUrl, { limit = 10 } = {}) {
  const m = String(fanUrl || '').trim().match(FAN_RE);
  if (!m) throw new Error('Нужна ссылка вида https://bandcamp.com/username (fan-профиль, не артист)');
  const pageUrl = `https://bandcamp.com/${m[1]}`;
  const html = await fetchFanPage(pageUrl);
  const fan = parseFan(html, pageUrl);

  // last_token для первой страницы сидит в collection_data
  const tok = html.match(/"collection_data":\{"redownload_urls":\{\},"last_token":"([^"]+)"/);
  let olderThan = tok ? tok[1].replace(/\\u0026/g, '&') : null;

  const items = [];
  const seen = new Set();
  while (items.length < limit) {
    const batch = await fetchBatch(fan.fanId, olderThan, Math.min(20, limit - items.length)).catch((e) => {
      logger.warn('[bandcamp-fan] batch failed', e.message);
      return null;
    });
    if (!batch || !Array.isArray(batch.items) || !batch.items.length) break;
    for (const it of batch.items) {
      if (!it.item_url || seen.has(it.item_url)) continue;
      seen.add(it.item_url);
      // Кастомные домены (label.bandcamp вместо *.bandcamp.com) нода не ест —
      // пересобираем канонический URL из url_hints (subdomain+slug).
      const uh = it.url_hints || {};
      const kind = it.tralbum_type === 't' ? 'track' : 'album';
      const url = (uh.subdomain && uh.slug)
        ? `https://${uh.subdomain}.bandcamp.com/${uh.item_type === 't' ? 'track' : 'album'}/${uh.slug}`
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
    olderThan = batch.last_token;
    if (!olderThan) break;
  }
  if (!items.length) throw new Error('Коллекция пуста или приватна');
  return { fan, items };
}

module.exports = { fetchCollection, FAN_RE };
