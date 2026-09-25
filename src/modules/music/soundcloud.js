// SoundCloud-провайдер: свой код на публичном API v2.
// client_id дёргаем со страниц SC (ротируется — обновляем при 401).
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let cachedId = null;

async function fetchClientId() {
  // client_id зашит в чанках веб-клиента; ищем сначала в HTML, потом в JS-ассетах
  const pages = ['https://soundcloud.com/', 'https://soundcloud.com/discover'];
  for (const page of pages) {
    try {
      const { data } = await axios.get(page, { timeout: 15000, headers: { 'User-Agent': UA } });
      const html = String(data);
      let m = html.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/);
      if (m) return m[1];
      const assets = [...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map(x => x[1]).slice(0, 12);
      for (let src of assets) {
        try {
          if (src.startsWith('/')) src = 'https://soundcloud.com' + src;
          const r = await axios.get(src, { timeout: 15000, headers: { 'User-Agent': UA } });
          m = String(r.data).match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/);
          if (m) return m[1];
        } catch {}
      }
    } catch {}
  }
  return null;
}

async function clientId(force = false) {
  if (cachedId && !force) return cachedId;
  cachedId = await fetchClientId();
  if (!cachedId) throw new Error('SoundCloud: нет client_id');
  return cachedId;
}

async function api(path, params = {}, retry = true) {
  const id = await clientId();
  try {
    const { data } = await axios.get(`https://api-v2.soundcloud.com${path}`, {
      params: { ...params, client_id: id }, timeout: 15000, headers: { 'User-Agent': UA },
    });
    return data;
  } catch (e) {
    if (retry && (e.response?.status === 401 || e.response?.status === 403)) {
      await clientId(true);
      const { data } = await axios.get(`https://api-v2.soundcloud.com${path}`, {
        params: { ...params, client_id: cachedId }, timeout: 15000, headers: { 'User-Agent': UA },
      });
      return data;
    }
    throw e;
  }
}

function pickStream(media) {
  const trs = media?.transcodings || [];
  const prog = trs.find(t => t.format?.protocol === 'progressive' && /mpeg|mp3|audio/i.test(t.format?.mime_type || ''));
  const anyProg = prog || trs.find(t => t.format?.protocol === 'progressive');
  if (anyProg) return { url: anyProg.url, hls: false };
  const hls = trs.find(t => t.format?.protocol === 'hls');
  if (hls) return { url: hls.url, hls: true };
  return null;
}

function trackItem(t, streamBase, hls) {
  return {
    title: t.title || 'SoundCloud track',
    author: t.user?.username || '',
    url: t.permalink_url || '',
    thumbnail: (t.artwork_url || t.user?.avatar_url || '').replace('-large.', '-t500x500.'),
    durationMs: t.duration || 0,
    streamUrl: streamBase, // API транскодинга; финальную ссылку даёт resolveStream() в момент игры
    hls: !!hls,
    isLive: false,
    source: 'soundcloud',
  };
}

async function withClientId(url) {
  const id = await clientId();
  return url + (url.includes('?') ? '&' : '?') + 'client_id=' + id;
}

// Финальная ссылка на файл — резолвится ПЕРЕД игрой (подписанные URL протухают)
async function resolveStream(item) {
  const apiUrl = await withClientId(item.streamUrl);
  if (item.hls) return apiUrl; // m3u8 отдаём в FFmpeg как есть
  const { data } = await axios.get(apiUrl, { timeout: 15000, headers: { 'User-Agent': UA } });
  if (!data?.url) throw new Error('SoundCloud: пустой transcode');
  return data.url;
}

async function resolveUrl(pageUrl) {
  const data = await api('/resolve', { url: pageUrl });
  if (data.kind === 'track') {
    const s = pickStream(data.media);
    if (!s) throw new Error('SoundCloud: нет потока у трека');
    return { kind: 'tracks', tracks: [trackItem(data, s.url, s.hls)] };
  }
  if (data.kind === 'playlist') {
    const tracks = [];
    for (const t of data.tracks || []) {
      const full = t.media ? t : await api(`/tracks/${t.id}`).catch(() => null);
      if (!full) continue;
      const s = pickStream(full.media);
      if (!s) continue;
      tracks.push(trackItem({ ...full, permalink_url: full.permalink_url || pageUrl }, s.url, s.hls));
      if (tracks.length >= 30) break;
    }
    if (!tracks.length) throw new Error('SoundCloud: плейлист пуст');
    return { kind: 'playlist', title: data.title, tracks };
  }
  throw new Error('SoundCloud: неизвестный тип ссылки');
}

async function search(query, limit = 5) {
  const data = await api('/search/tracks', { q: query, limit });
  const tracks = [];
  for (const t of data.collection || []) {
    const s = pickStream(t.media);
    if (!s) continue;
    tracks.push(trackItem(t, s.url, s.hls));
    if (tracks.length >= limit) break;
  }
  return tracks;
}

module.exports = { resolveUrl, search, withClientId, resolveStream, clientId };
