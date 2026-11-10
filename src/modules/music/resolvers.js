// Routing queries to Lavalink engine: any input -> { engine, query }.
// URL resolved by node itself (LavaSrc/built-in sources), text search --
// by source prefix. Default -- YouTube (works again 2026-10-04:
// ANDROID_VR/WEB clients bypass IP ban). If it breaks again -- fall back to scsearch.
// Legacy hpsb engine REMOVED (bot exclusively on lavalink): no direct byte downloads here.

const SEARCH_PREFIX = {
  youtube: 'ytsearch:',
  soundcloud: 'scsearch:',
  spotify: 'spsearch:',
  deezer: 'dzsearch:',
  applemusic: 'amsearch:',
  tidal: 'tdsearch:',
  qobuz: 'qbsearch:',
  yandex: 'ymsearch:',
  vk: 'vksearch:',
};

function detectEngine(value) {
  const v = String(value || '');
  if (/soundcloud\.com|on\.soundcloud/i.test(v)) return 'soundcloud';
  if (/open\.spotify\.com|spotify\.com/i.test(v)) return 'spotify';
  if (/(^|\.)deezer\.com|deezer\.page\.link/i.test(v)) return 'deezer';
  if (/music\.apple\.com/i.test(v)) return 'applemusic';
  if (/tidal\.com/i.test(v)) return 'tidal';
  if (/(^|\.)qobuz\.com|open\.qobuz|play\.qobuz/i.test(v)) return 'qobuz';
  if (/music\.yandex\.(ru|com|kz|by|uz)|yandex\.(ru|com)\/.*music/i.test(v)) return 'yandex';
  if (/vk\.com\/(audio|music|audios)|vk\.ru\/(music|artist)/i.test(v)) return 'vk';
  if (/audiomack\.com/i.test(v)) return 'audiomack';
  if (/youtube\.com|youtu\.be/i.test(v)) return 'youtube';
  if (/bandcamp\.com/i.test(v)) return 'bandcamp';
  // Direct audio stream/file (radio, mp3) -- node treats as http source.
  if (/\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)/i.test(v)) return 'arbitrary';
  return null;
}

function resolveSearchQuery(query) {
  const value = String(query || '').trim();
  if (!value) throw new Error('Empty query');
  if (/^(ytsearch|ytmsearch|scsearch|spsearch|dzsearch|dzisrc|amsearch|tdsearch|qbsearch|qbisrc|ymsearch|vksearch):/i.test(value)) {
    const pref = value.split(':')[0].toLowerCase();
    const byPrefix = {
      ytsearch: 'youtube', ytmsearch: 'youtube', scsearch: 'soundcloud', spsearch: 'spotify',
      dzsearch: 'deezer', dzisrc: 'deezer', amsearch: 'applemusic', tdsearch: 'tidal',
      qbsearch: 'qobuz', qbisrc: 'qobuz', ymsearch: 'yandex', vksearch: 'vk',
    };
    return { engine: byPrefix[pref] || 'youtube', query: value }; // respect prefix as-is
  }
  if (/^https?:\/\//i.test(value)) {
    const engine = detectEngine(value) || 'arbitrary';
    return { engine, query: value }; // URL resolved by node
  }
  return { engine: 'youtube', query: `${SEARCH_PREFIX.youtube}${value}` };
}

module.exports = { resolveSearchQuery, SEARCH_PREFIX, detectEngine };
