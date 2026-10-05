// Instagram source: webhook/API-first, NO mandatory scraping.
// Polling providers (Graph API / session scrape) are optional and isolated here.
// Without credentials the source reports unavailable instead of silently dying.
const { truncate } = require('./fetch');

function normalizePost(p, username) {
  const id = String(p.id || p.shortcode || p.pk || '');
  if (!id) return null;
  const user = String(username || p.username || '').replace(/^@/, '');
  const isReel = /reel|video|clip/i.test(String(p.type || p.media_type || ''));
  return {
    source: 'instagram',
    type: isReel ? 'reel' : 'post',
    id,
    author: user,
    title: truncate(String(p.caption ?? p.title ?? 'Instagram'), 250),
    description: '',
    url: p.url || (p.shortcode ? `https://www.instagram.com/p/${p.shortcode}/` : ''),
    image: p.image || p.thumbnail || p.display_url || '',
    publishedAt: p.publishedAt || p.taken_at || '',
    target: 'media',
    metadata: { username: user },
  };
}

// Normalize an incoming webhook payload (official API or legacy Make)
// to a Publisher event. Returns null when the payload is unusable.
function normalizeWebhook(body = {}) {
  const b = body || {};
  const rawId = String(b.id || b.media_id || b.shortcode || '');
  // Strip tracking params: same post with different ?utm/?igsh must share a key.
  let urlId = '';
  try {
    const u = new URL(String(b.url || ''));
    urlId = u.origin + u.pathname;
  } catch { urlId = ''; }
  const id = rawId || urlId;
  if (!id && !b.url) return null;
  const username = String(b.username || b.user || '').replace(/^@/, '');
  return {
    source: 'instagram',
    type: /reel/i.test(String(b.type || '')) ? 'reel' : 'post',
    id: id || String(b.url || ''),
    author: username,
    title: truncate(String(b.title || b.caption || 'Instagram'), 250),
    description: truncate(String(b.description || ''), 1000),
    url: b.url || (b.shortcode ? `https://www.instagram.com/p/${b.shortcode}/` : ''),
    image: b.image || b.thumbnail || '',
    publishedAt: b.publishedAt || b.timestamp || new Date().toISOString(),
    target: 'media',
    metadata: { username },
  };
}

// Availability for status lines: official token, legacy map, or nothing.
function availability(cfg = {}) {
  if (cfg?.publisher?.instagram?.accessToken) return { ok: true, via: 'api' };
  if ((cfg?.reposter?.instagram || []).length) return { ok: true, via: 'legacy-map' };
  return { ok: false, via: 'none', hint: 'missing INSTAGRAM_ACCESS_TOKEN' };
}

module.exports = { normalizePost, normalizeWebhook, availability };
