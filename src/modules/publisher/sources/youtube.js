// YouTube source: Data API v3 -> RSS -> scrape fallback chain.
// Normalizes to Publisher events { source:'youtube', type:'video'|'short' }.
// Polling is FALLBACK only -- PubSubHubbub push (webhooks.js) is primary.
const { get, dateMs, truncate } = require('./fetch');
const { logger } = require('../../../utils/logger');

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const { XMLParser } = require('fast-xml-parser');
const ytParser = new XMLParser({ ignoreAttributes: false });

function normalize(item, channelTitle) {
  const id = String(item.id || '').trim();
  if (!id) return null;
  const url = `https://www.youtube.com/watch?v=${id}`;
  return {
    source: 'youtube',
    // NOTE: type is always 'video' (never sniff 'short' from the title):
    // a title heuristic gives the same videoId different dedup keys across
    // API/RSS/scrape transports and double-posts.
    type: 'video',
    id,
    author: item.author || channelTitle || '',
    title: item.title || id,
    description: '',
    url,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: item.date || '',
    target: 'media',
    metadata: { channelId: item.channelId || '' },
  };
}

async function fetchViaApi(ytId, apiKey, http) {
  const client = http || require('axios');
  const ch = await client.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { part: 'contentDetails', id: ytId, key: apiKey }, timeout: 15000,
  });
  const uploads = ch.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];
  const pl = await client.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: { part: 'snippet,contentDetails', playlistId: uploads, maxResults: 8, key: apiKey }, timeout: 15000,
  });
  return (pl.data?.items || []).map((i) => ({
    id: i.contentDetails?.videoId,
    title: i.snippet?.title,
    author: i.snippet?.channelTitle,
    date: i.contentDetails?.videoPublishedAt || i.snippet?.publishedAt || '',
    channelId: ytId,
  })).filter((x) => x.id);
}

async function fetchViaRss(ytId, http) {
  const client = http || require('axios');
  const res = await client.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytId}`, {
    timeout: 15000, headers: { 'User-Agent': YT_UA },
  });
  const feed = ytParser.parse(res.data);
  const raw = feed?.feed?.entry;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return entries.slice(0, 8).map((en) => ({
    id: en['yt:videoId'],
    title: en.title,
    author: en?.author?.name,
    date: en.published || en.updated || '',
    channelId: ytId,
  })).filter((x) => x.id);
}

async function fetchViaScrape(ytId, http) {
  const client = http || require('axios');
  const res = await client.get(`https://www.youtube.com/channel/${ytId}/videos`, {
    timeout: 20000, headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  }).catch(() => ({ data: '' }));
  const re = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  const ids = [];
  const seen = new Set();
  let m;
  const html = String(res.data || '');
  while ((m = re.exec(html)) && ids.length < 12) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids.map((id) => ({ id, channelId: ytId }));
}

// Returns raw items (newest-first like the upstream). Never throws.
async function fetchLatestYouTube(ytId, { apiKey, http } = {}) {
  if (apiKey) {
    try {
      const items = await fetchViaApi(ytId, apiKey, http);
      if (items.length) return items;
    } catch (e) { logger.warn(`[publisher/youtube] api fallback: ${e.message}`); }
  }
  try {
    const items = await fetchViaRss(ytId, http);
    if (items.length) return items;
  } catch (e) { logger.warn(`[publisher/youtube] rss blocked (${e.message}), trying scrape`); }
  try {
    return await fetchViaScrape(ytId, http);
  } catch (e) {
    logger.warn(`[publisher/youtube] scrape failed: ${e.message}`);
    return [];
  }
}

async function enrichTitles(items, http) {
  const client = http || require('axios');
  return Promise.all(items.map(async (item) => {
    if (item.title) return item;
    try {
      const res = await client.get('https://www.youtube.com/oembed', {
        params: { url: `https://www.youtube.com/watch?v=${item.id}`, format: 'json' }, timeout: 15000,
      });
      return { ...item, title: res.data?.title || item.id, author: item.author || res.data?.author_name || '' };
    } catch { return item; }
  }));
}

// Fetch all configured YT channels -> normalized events, oldest-first.
// opts: { apiKey, channels: [{key}], http }.
async function fetchYouTube({ apiKey, channels = [], http } = {}) {
  const out = [];
  for (const ch of channels) {
    const ytId = ch?.key;
    if (!ytId) continue;
    try {
      const items = await fetchLatestYouTube(ytId, { apiKey, http });
      const rich = await enrichTitles(items, http);
      // Dated oldest-first; undated (scrape fallback) keep feed-relative order
      // reversed (feed is newest-first, so reverse = oldest-first assumption).
      const dated = [];
      const undated = [];
      for (const item of rich) {
        const ev = normalize(item);
        if (!ev) continue;
        if (ev.publishedAt) dated.push(ev);
        else undated.push(ev);
      }
      dated.sort((a, b) => (dateMs(a.publishedAt) - dateMs(b.publishedAt)));
      out.push(...dated, ...undated.reverse());
    } catch (e) { logger.warn(`[publisher/youtube] ${ytId}: ${e.message}`); }
  }
  return out;
}

module.exports = { fetchLatestYouTube, fetchYouTube, normalize, truncate };
