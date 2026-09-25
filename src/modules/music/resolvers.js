// Резолвер-оркестратор: любой запрос -> [{трек с ПРЯМЫМ аудио}].
// Никаких мостов и магии: каждый трек знает, откуда брать байты.
// item.stream: { type: 'direct', url } | { type: 'soundcloud', api, hls } | { type: 'preview', url }
const axios = require('axios');

const DIRECT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen/i;
const UA = 'HPSB-Core-Bot/1.0';

async function preflightStream(url) {
  try {
    const r = await axios.get(url, {
      responseType: 'stream', timeout: 12000, validateStatus: () => true,
      headers: { 'User-Agent': UA, 'Icy-MetaData': '0' },
    });
    const code = r.status;
    const ct = r.headers?.['content-type'] || '?';
    try { r.data?.destroy?.(); } catch {}
    if (code >= 200 && code < 300 && /^(audio|video|application\/ogg|application\/x-mpegurl|application\/vnd\.apple)/i.test(ct)) return;
    throw new Error(`HTTP ${code} (${ct})`);
  } catch (e) {
    if (/^HTTP \d+/.test(e.message)) throw new Error(`Поток недоступен: ${e.message}`);
    throw new Error(`Поток недоступен: ${e.code || e.message} (сеть режет стрим)`);
  }
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// resolve(query) -> { kind: 'tracks'|'playlist', title?, tracks: [item] }
// item: { title, author, url, thumbnail, durationMs, requester?, stream, source }
async function resolve(query) {
  query = String(query || '').trim();
  if (!query) throw new Error('Пустой запрос');

  // 1) Прямой файл/эфир
  if (/^https?:\/\//i.test(query) && DIRECT_RE.test(query)) {
    await preflightStream(query);
    const name = (query.split('/').filter(Boolean).pop() || 'stream').split('?')[0];
    return { kind: 'tracks', tracks: [{
      title: decodeURIComponent(name), author: hostOf(query), url: query,
      thumbnail: '', durationMs: 0, isLive: true, source: 'direct',
      stream: { type: 'direct', url: query },
    }] };
  }

  // 2) Bandcamp-страницы
  if (/bandcamp\.com/i.test(query)) {
    const { resolveBandcamp } = require('./bandcamp');
    const bc = await resolveBandcamp(query);
    if (!bc) throw new Error('Bandcamp: нет стримов на странице');
    const multi = bc.tracks.length > 1;
    return {
      kind: multi ? 'bandcamp-album' : 'tracks',
      title: `${bc.title || ''} — ${bc.artist || ''}`,
      albumTitle: bc.title || '', albumArtist: bc.artist || '',
      tracks: bc.tracks.map(t => ({
        title: t.title, author: bc.artist || 'Bandcamp', url: query,
        thumbnail: bc.artwork || '', durationMs: t.durationMs || 0, isLive: false,
        source: 'bandcamp', stream: { type: 'direct', url: t.stream },
      })),
    };
  }

  // 3) SoundCloud-ссылки
  if (/soundcloud\.com|on\.soundcloud/i.test(query)) {
    const sc = require('./soundcloud');
    const r = await sc.resolveUrl(query);
    return {
      kind: r.kind === 'playlist' ? 'playlist' : 'tracks',
      title: r.title || undefined,
      tracks: r.tracks.map(t => ({
        title: t.title, author: t.author, url: t.url || query,
        thumbnail: t.thumbnail || '', durationMs: t.durationMs || 0, isLive: false,
        source: 'soundcloud', stream: { type: 'soundcloud', api: t.streamUrl, hls: t.hls },
      })),
    };
  }

  // 4) Spotify-ссылки: метаданные -> аудио через SoundCloud, иначе превью
  if (/open\.spotify\.com/i.test(query)) {
    const sp = require('./spotify');
    const sc = require('./soundcloud');
    const r = await sp.resolveUrl(query);
    const tracks = [];
    for (const t of r.tracks.slice(0, 30)) {
      const q = sp.trackQuery(t);
      const found = await sc.search(q, 3).catch(() => []);
      // берём лучшее совпадение по длине (эвристика против каверов)
      const best = found[0];
      if (best) {
        tracks.push({
          title: t.spotifyTitle, author: t.spotifyArtist, url: t.url,
          thumbnail: best.thumbnail || t.artwork, durationMs: best.durationMs || t.durationMs || 0,
          isLive: false, source: 'soundcloud',
          stream: { type: 'soundcloud', api: best.streamUrl, hls: best.hls },
        });
      } else if (t.previewUrl) {
        tracks.push({
          title: `${t.spotifyTitle} (превью 30с)`, author: t.spotifyArtist, url: t.url,
          thumbnail: t.artwork, durationMs: 30000, isLive: false,
          source: 'preview', stream: { type: 'direct', url: t.previewUrl },
        });
      }
    }
    if (!tracks.length) throw new Error('Spotify: не нашёл аудио (SoundCloud пуст, превью нет)');
    return { kind: r.kind === 'playlist' ? 'playlist' : 'tracks', title: r.title, tracks };
  }

  // 5) Audiomack-страницы без файла — честно отказываем
  if (/audiomack\.com/i.test(query)) {
    throw new Error('Audiomack: нужна прямая mp3/m3u8-ссылка');
  }

  // 6) Обычный текст -> поиск SoundCloud (YouTube запаркован)
  const sc = require('./soundcloud');
  const found = await sc.search(query, 1);
  if (!found.length) throw new Error(`Ничего не найдено: «${query.slice(0, 100)}»`);
  const t = found[0];
  return { kind: 'tracks', tracks: [{
    title: t.title, author: t.author, url: t.url,
    thumbnail: t.thumbnail, durationMs: t.durationMs || 0, isLive: false,
    source: 'soundcloud', stream: { type: 'soundcloud', api: t.streamUrl, hls: t.hls },
  }] };
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'stream'; }
}

module.exports = { resolve, preflightStream, fmtDur };
