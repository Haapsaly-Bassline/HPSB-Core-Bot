// YouTube live detection (multistream second half; Twitch EventSub is first).
// No reliable push for YT live without extra infra, so this is polled:
//   - with YT_API_KEY: search.list channelId + eventType=live (accurate);
//   - without: GET /channel/<id>/live -- YouTube 302-redirects to /watch?v=...
//     ONLY while live, otherwise the channel page (final URL tells the truth).
// Returns per channel: { channelId, live, videoId, url, title, author }.
const { logger } = require('../../../utils/logger');

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function watchIdFromUrl(u) {
  try {
    const url = new URL(String(u || ''));
    if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
      return url.searchParams.get('v') || '';
    }
  } catch {}
  return '';
}

async function viaApi(ytId, apiKey, http) {
  const client = http || require('axios');
  const res = await client.get('https://www.googleapis.com/youtube/v3/search', {
    params: { part: 'snippet', channelId: ytId, eventType: 'live', type: 'video', maxResults: 1, key: apiKey },
    timeout: 15000,
  });
  const item = res.data?.items?.[0];
  const videoId = item?.id?.videoId || '';
  if (!videoId) return { channelId: ytId, live: false };
  return {
    channelId: ytId, live: true, videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: item.snippet?.title || 'Live',
    author: item.snippet?.channelTitle || '',
  };
}

async function viaRedirect(ytId, http) {
  const client = http || require('axios');
  const res = await client.get(`https://www.youtube.com/channel/${ytId}/live`, {
    timeout: 15000, maxRedirects: 5,
    headers: { 'User-Agent': YT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const finalUrl = res?.request?.res?.responseUrl || res?.config?.url || '';
  const videoId = watchIdFromUrl(finalUrl);
  if (!videoId) return { channelId: ytId, live: false };
  let title = 'Live';
  let author = '';
  try {
    const oembed = await client.get('https://www.youtube.com/oembed', {
      params: { url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' },
      timeout: 15000,
    });
    title = oembed.data?.title || title;
    author = oembed.data?.author_name || author;
  } catch {}
  return { channelId: ytId, live: true, videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title, author };
}

// Check every configured channel. Never throws (per-channel errors -> offline).
async function checkYoutubeLive({ channels = [], apiKey, http } = {}) {
  const out = [];
  for (const ch of channels) {
    const ytId = ch?.key;
    if (!ytId) continue;
    try {
      out.push(apiKey ? await viaApi(ytId, apiKey, http) : await viaRedirect(ytId, http));
    } catch (e) {
      logger.warn(`[publisher/youtube-live] ${ytId}: ${e.message}`);
      out.push({ channelId: ytId, live: false, error: String(e.message || e).slice(0, 100) });
    }
  }
  return out;
}

module.exports = { checkYoutubeLive, watchIdFromUrl };
