// Bandcamp-провайдер: страница трека/альбома -> прямые mp3-стримы.
// Свой код: тянем TralbumData.trackinfo из HTML, без чужих библиотек.
const axios = require('axios');

// Bandcamp отдаёт Client Challenge браузерным UA с незнакомых IP — нейтральный UA проходит.
const UA = 'curl/8.5.0';

function unesc(s) {
  try { return JSON.parse(`"${s}"`); } catch { return s; }
}

function meta(html, prop) {
  const m = String(html).match(new RegExp('<meta[^>]+property="' + prop + '"[^>]+content="([^"]+)"', 'i'))
    || String(html).match(new RegExp('<meta[^>]+content="([^"]+)"[^>]+property="' + prop + '"', 'i'));
  return m ? m[1] : '';
}

// Вырезает JSON-массив после ключа "trackinfo": со сканом скобок (строки учитываем)
function extractTrackinfo(html) {
  const key = '"trackinfo":';
  const start = String(html).indexOf(key);
  if (start < 0) return null;
  let i = start + key.length;
  while (/\s/.test(html[i])) i++;
  if (html[i] !== '[') return null;
  let depth = 0, inStr = false, esc = false, begin = i;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) { try { return JSON.parse(html.slice(begin, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function resolveBandcamp(url) {
  if (!/bandcamp\.com/i.test(url || '')) return null;
  const { data: html } = await axios.get(url, {
    timeout: 20000, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const ogTitle = meta(html, 'og:title'); // "Album, by Artist"
  const artwork = meta(html, 'og:image');
  let artist = '', pageTitle = ogTitle;
  const byIdx = ogTitle.lastIndexOf(', by ');
  if (byIdx > 0) { pageTitle = ogTitle.slice(0, byIdx); artist = ogTitle.slice(byIdx + 5); }

  // trackinfo лежит HTML-эскейпленным в data-tralbum — разэскейпливаем для скана
  const clean = String(html).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const info = extractTrackinfo(clean);
  if (!info || !info.length) return null;
  const tracks = info
    .map(t => {
      const stream = t?.file?.['mp3-128'];
      if (!stream || !/^https:\/\//.test(stream)) return null;
      return {
        title: unesc(t.title || pageTitle || 'Bandcamp track'),
        stream,
        durationMs: t.duration ? Math.round(Number(t.duration) * 1000) : 0,
      };
    })
    .filter(Boolean);
  if (!tracks.length) return null;
  return { artist, title: pageTitle, artwork, tracks, pageUrl: url };
}

module.exports = { resolveBandcamp };
