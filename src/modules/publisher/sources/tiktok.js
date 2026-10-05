// TikTok source: TikWM provider behind a provider boundary.
// Core Publisher never talks TikWM directly -- only via fetchTikTok().
// Polling only; official API can replace this provider later untouched.
const { dateMs, truncate } = require('./fetch');
const { logger } = require('../../../utils/logger');

function normalize(v, username) {
  const vid = String(v.video_id || v.id || v.aweme_id || '');
  const uname = String(username || '').replace(/^@/, '');
  if (!vid || !uname) return null;
  return {
    source: 'tiktok',
    type: 'video',
    id: vid,
    author: uname,
    title: truncate(String(v.title ?? v.desc ?? 'TikTok'), 250),
    description: '',
    url: `https://www.tiktok.com/@${uname}/video/${vid}`,
    image: v.cover || v.ai_dynamic_cover || v.origin_cover || '',
    publishedAt: Number(v.create_time) > 0 ? new Date(Number(v.create_time) * 1000).toISOString() : '',
    target: 'media',
    metadata: { username: uname },
  };
}

async function fetchUserPosts(username, { http, count = 6 } = {}) {
  const client = http || require('axios');
  const uname = String(username || '').replace(/^@/, '');
  if (!uname) return [];
  const res = await client.get(
    `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(uname)}&count=${count}`,
    { timeout: 15000 },
  );
  const videos = res.data?.data?.videos || res.data?.data?.posts || [];
  return Array.isArray(videos) ? videos : [];
}

// Fetch all configured accounts -> normalized events, oldest-first.
async function fetchTikTok({ accounts = [], http } = {}) {
  const out = [];
  for (const acc of accounts) {
    const username = acc?.key;
    if (!username) continue;
    try {
      const videos = await fetchUserPosts(username, { http });
      for (const v of videos) {
        const ev = normalize(v, username);
        if (ev) out.push(ev);
      }
    } catch (e) { logger.warn(`[publisher/tiktok] ${username}: ${e.message}`); }
  }
  return out.sort((a, b) => (dateMs(a.publishedAt) - dateMs(b.publishedAt)));
}

module.exports = { fetchTikTok, fetchUserPosts, normalize };
