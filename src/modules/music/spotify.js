// Spotify БЕЗ API-ключей (новым приложениям API закрыт без Premium):
// метаданные тянем из embed-страницы (__NEXT_DATA__), аудио — через SoundCloud-поиск.
// Бонус: у треков есть официальное 30с-превью как последний фолбэк.
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchEntity(kind, id) {
  const { data } = await axios.get(`https://open.spotify.com/embed/${kind}/${id}`, {
    timeout: 15000, headers: { 'User-Agent': UA },
  });
  const m = String(data).match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('Spotify: нет данных embed');
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify: пустой entity');
  return entity;
}

function artworkOf(entity) {
  const imgs = entity?.visualIdentity?.image || entity?.images || [];
  return imgs[0]?.url || '';
}

// Возвращает { kind: 'tracks'|'playlist', title, tracks: [{ spotifyTitle, spotifyArtist, artwork, durationMs, previewUrl, url }] }
async function resolveUrl(url) {
  const m = String(url).match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const [, kind, id] = m;
  const entity = await fetchEntity(kind, id);
  const art = artworkOf(entity);
  if (kind === 'track') {
    return {
      kind: 'tracks',
      tracks: [{
        spotifyTitle: entity.title || 'Spotify track', spotifyArtist: entity.subtitle || '',
        artwork: art, durationMs: entity.duration || 0, previewUrl: null,
        url: `https://open.spotify.com/track/${id}`,
      }],
    };
  }
  const list = entity.trackList || [];
  const tracks = list.map(t => ({
    spotifyTitle: t.title || entity.title, spotifyArtist: t.subtitle || entity.subtitle || '',
    artwork: art, durationMs: t.duration || 0,
    previewUrl: t.audioPreview?.url || null,
    url: `https://open.spotify.com/${kind}/${id}`,
  }));
  if (!tracks.length) throw new Error('Spotify: пустой плейлист');
  return { kind: 'playlist', title: `${entity.title || 'Spotify'} — ${entity.subtitle || ''}`, tracks };
}

function trackQuery(t) {
  return `${t.spotifyArtist || ''} ${t.spotifyTitle || ''}`.trim();
}

module.exports = { resolveUrl, trackQuery };
