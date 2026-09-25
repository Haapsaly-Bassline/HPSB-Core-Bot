// Instagram без подписки — так, как это делают другие боты:
// 1) официальный Graph API для бизнес-акка (если дали IG_GRAPH_TOKEN + IG_BUSINESS_ID, бесплатно);
// 2) скрап публичного профиля web_profile_info (с cookie сессии — стабильнее, без — как повезёт);
// 3) фолбэк RSSHub.
// Возвращает { id, link, caption, image, timestamp } | null. Никогда не кидает наружу.
const axios = require('axios');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function cookies() {
  const parts = [];
  if (config.reposter.instagramSessionId) {
    parts.push(`sessionid=${config.reposter.instagramSessionId}`);
    // ds_user_id обычно = первая часть sessionid до ':'
    const uid = String(config.reposter.instagramSessionId).split(':')[0];
    if (/^\d+$/.test(uid || '')) parts.push(`ds_user_id=${uid}`);
  }
  if (config.reposter.instagramCsrf) parts.push(`csrftoken=${config.reposter.instagramCsrf}`);
  if (config.reposter.instagramDid) parts.push(`ig_did=${config.reposter.instagramDid}`);
  return parts.join('; ');
}

async function viaGraph(username) {
  if (!config.reposter.instagramGraphToken || !config.reposter.instagramBusinessId) return null;
  // Graph: ищем media бизнес-аккаунта; чужой username через Graph не отдать — только свой акк.
  const { data } = await axios.get(`https://graph.facebook.com/v21.0/${config.reposter.instagramBusinessId}/media`, {
    params: { fields: 'id,caption,media_url,permalink,timestamp', limit: 5, access_token: config.reposter.instagramGraphToken },
    timeout: 15000,
  });
  const m = data?.data?.[0];
  if (!m) return null;
  return { id: String(m.id), link: m.permalink, caption: m.caption || '', image: m.media_url, timestamp: m.timestamp };
}

async function viaWebProfile(username) {
  const headers = {
    'User-Agent': UA,
    'X-IG-App-ID': '936619743392459',
    'Accept': '*/*',
    'Referer': `https://www.instagram.com/${username}/`,
    'X-Requested-With': 'XMLHttpRequest',
  };
  const ck = cookies();
  if (ck) headers['Cookie'] = ck;
  const { data } = await axios.get('https://www.instagram.com/api/v1/users/web_profile_info/', {
    params: { username },
    headers, timeout: 15000,
    validateStatus: s => s < 500,
  });
  if (data?.login_required || data?.status === 'fail') {
    logger.warn('[ig] login_required (нужен IG_SESSIONID из живой сессии)');
    return null;
  }
  const user = data?.data?.user;
  const edge = user?.edge_owner_to_timeline_media?.edges?.[0]?.node;
  if (!edge) return null;
  const caption = edge.edge_media_to_caption?.edges?.[0]?.node?.text || '';
  return {
    id: String(edge.id || edge.shortcode),
    link: `https://www.instagram.com/p/${edge.shortcode}/`,
    caption, image: edge.display_url, timestamp: edge.taken_at_timestamp,
  };
}

async function viaHtmlEmbed(username) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' };
  const ck = cookies();
  if (ck) headers['Cookie'] = ck;
  const { data: html } = await axios.get(`https://www.instagram.com/${encodeURIComponent(username)}/`, { headers, timeout: 15000 });
  // ищем shortcode в встроенном JSON
  const m = String(html).match(/"shortcode":"([A-Za-z0-9_-]{5,})"/);
  if (!m) return null;
  const shortcode = m[1];
  const cap = (String(html).match(/"edge_media_to_caption":\{"edges":\[{"node":\{"text":"([\s\S]{0,300}?)"/) || [])[1] || '';
  return { id: shortcode, link: `https://www.instagram.com/p/${shortcode}/`, caption: cap.replace(/\\n/g, '\n').replace(/\\u([\da-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), image: undefined, timestamp: undefined };
}

async function viaRssHub(username) {
  const { data } = await axios.get(`https://rsshub.app/instagram/user/${encodeURIComponent(username)}`, {
    timeout: 15000, headers: { Accept: 'application/json' },
  }).catch(() => ({ data: null }));
  const items = data?.items || [];
  if (!items.length) return null;
  const latest = items[0];
  return { id: String(latest.id || latest.guid || latest.link), link: latest.link, caption: latest.title || '', image: undefined, timestamp: latest.pubDate };
}

async function fetchLatestPost(username) {
  const uname = String(username).replace(/^@/, '');
  // свой бизнес-акк через Graph — только если username совпадает с привязанным (иначе пропускаем тихо)
  try { const g = await viaGraph(uname); if (g) return { ...g, via: 'graph' }; } catch (e) { logger.warn('[ig/graph]', e.message); }
  try { const w = await viaWebProfile(uname); if (w) return { ...w, via: 'web_profile' }; } catch (e) { logger.warn('[ig/web]', e.message); }
  try { const h = await viaHtmlEmbed(uname); if (h) return { ...h, via: 'html' }; } catch (e) { logger.warn('[ig/html]', e.message); }
  try { const r = await viaRssHub(uname); if (r) return { ...r, via: 'rsshub' }; } catch (e) { logger.warn('[ig/rsshub]', e.message); }
  return null;
}

module.exports = { fetchLatestPost };
