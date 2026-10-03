// Роутинг запросов на Lavalink-движок: любой ввод -> { engine, query }.
// URL нода резолвит сама (LavaSrc/встроенные источники), текстовый поиск —
// префиксом источника. Дефолт — SoundCloud: работает без ключей и IP-бана.
// YouTube/Spotify-запросы пропускаем как есть — нода ответит понятной ошибкой,
// пока YouTube забанен по IP (см. lavalink/application.yml).
// Legacy hpsb engine УДАЛЁН (бот исключительно на lavalink): прямого скачивания
// байтов тут больше нет.

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
  // Прямой аудиопоток/файл (радио, mp3) — нода берёт как http-источник.
  if (/\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)/i.test(v)) return 'arbitrary';
  return null;
}

function resolveSearchQuery(query) {
  const value = String(query || '').trim();
  if (!value) throw new Error('Пустой запрос');
  if (/^ytsearch:|^scsearch:|^spsearch:|^dzsearch:|^amsearch:|^tdsearch:|^qbsearch:|^ymsearch:|^vksearch:/i.test(value)) {
    return { engine: 'youtube', query: value }; // явный префикс — уважаем как есть
  }
  if (/^https?:\/\//i.test(value)) {
    const engine = detectEngine(value) || 'arbitrary';
    return { engine, query: value }; // URL резолвит сама нода
  }
  return { engine: 'soundcloud', query: `${SEARCH_PREFIX.soundcloud}${value}` };
}

module.exports = { resolveSearchQuery, SEARCH_PREFIX, detectEngine };
