// Public SoundCloud profile importer.
// Supports profile tabs: all, tracks, albums, sets/playlists, likes and reposts.
// Uses SoundCloud's own public web API endpoints and follows next_href pagination.
const API_BASE = 'https://api-v2.soundcloud.com/';
const PAGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const PAGE_NAMES = {
  all: 'All',
  tracks: 'Tracks',
  albums: 'Albums',
  sets: 'Playlists',
  likes: 'Likes',
  reposts: 'Reposts',
};
const RESERVED_USERNAMES = new Set([
  'discover', 'charts', 'you', 'upload', 'search', 'stream', 'settings',
  'stations', 'player', 'popular', 'pages', 'tags', 'mobile', 'groups',
]);
const RESOURCE_ALIASES = { playlists: 'sets' };
const RESOURCE_PATHS = {
  all: (id) => 'stream/users/' + id,
  tracks: (id) => 'users/' + id + '/tracks',
  albums: (id) => 'users/' + id + '/albums',
  sets: (id) => 'users/' + id + '/playlists',
  likes: (id) => 'users/' + id + '/likes',
  reposts: (id) => 'stream/users/' + id + '/reposts',
};
const MAX_API_PAGES = 12;
const API_PAGE_SIZE = 200;

function parseProfileUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts.length < 1 || parts.length > 2) return null;
  const username = parts[0];
  if (!username || RESERVED_USERNAMES.has(username.toLowerCase())) return null;

  let section = parts[1] ? parts[1].toLowerCase() : 'all';
  section = RESOURCE_ALIASES[section] || section;
  if (!Object.prototype.hasOwnProperty.call(RESOURCE_PATHS, section)) return null;

  return {
    username,
    section,
    sectionLabel: PAGE_NAMES[section],
    profileUrl: 'https://soundcloud.com/' + encodeURIComponent(username),
    pageUrl: 'https://soundcloud.com/' + encodeURIComponent(username) +
      (section === 'all' ? '' : '/' + section),
  };
}

function endpointForProfile(userId, section) {
  const pathFactory = RESOURCE_PATHS[String(section || 'all').toLowerCase()];
  if (!pathFactory) throw new Error('Unsupported SoundCloud profile page: ' + section);
  const id = String(userId || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('SoundCloud returned an invalid user ID');
  return new URL(pathFactory(id), API_BASE).href;
}

function extractClientId(text) {
  const source = String(text || '');
  const patterns = [
    /(?:client_id|clientId)["']?\s*[:=]\s*["']([a-z\d_-]{24,80})["']/i,
    /["']client_id["']\s*,\s*["']([a-z\d_-]{24,80})["']/i,
  ];
  for (const re of patterns) {
    const match = source.match(re);
    if (match) return match[1];
  }
  return null;
}

function extractScriptUrls(html, baseUrl) {
  const urls = [];
  const seen = new Set();
  const re = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    const raw = match[2].replace(/&amp;/g, '&');
    try {
      const url = new URL(raw, baseUrl);
      const host = url.hostname.toLowerCase();
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      if (!(host.endsWith('.sndcdn.com') || host === 'soundcloud.com' || host.endsWith('.soundcloud.com'))) continue;
      if (!/\.js$/i.test(url.pathname)) continue;
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      urls.push(url.href);
    } catch {}
  }
  return urls;
}

async function fetchText(url, timeoutMs = 15000, accept = '*/*') {
  const response = await fetch(url, {
    headers: { 'User-Agent': PAGE_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
    throw new Error('HTTP ' + response.status + (body ? ': ' + body : ''));
  }
  return response.text();
}

async function clientIdFromPage(html, pageUrl) {
  const direct = extractClientId(html);
  if (direct) return direct;

  let scriptUrls = extractScriptUrls(html, pageUrl);
  if (!scriptUrls.length) {
    const home = await fetchText('https://soundcloud.com/', 15000, PAGE_ACCEPT).catch(() => '');
    const id = extractClientId(home);
    if (id) return id;
    scriptUrls = extractScriptUrls(home, 'https://soundcloud.com/');
  }

  // The ID is usually embedded in one of SoundCloud's first-party JavaScript bundles.
  const candidates = scriptUrls.slice(0, 16);
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = await Promise.all(candidates.slice(i, i + 4).map(async (url) => {
      try { return extractClientId(await fetchText(url, 10000)); } catch { return null; }
    }));
    const found = batch.find(Boolean);
    if (found) return found;
  }

  throw new Error('Could not find SoundCloud web client ID. SoundCloud may be blocking profile/API requests or may have changed its web bundles.');
}

function assertApiUrl(value) {
  let url;
  try { url = new URL(value, API_BASE); } catch { throw new Error('SoundCloud returned an invalid pagination URL'); }
  if (!['https:', 'http:'].includes(url.protocol) ||
      !['api-v2.soundcloud.com', 'api.soundcloud.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('SoundCloud returned an unexpected API pagination host');
  }
  return url;
}

async function requestJson(value, clientId, { list = true } = {}) {
  const url = assertApiUrl(value);
  url.searchParams.set('client_id', clientId);
  if (list) {
    if (!url.searchParams.has('limit')) url.searchParams.set('limit', String(API_PAGE_SIZE));
    if (!url.searchParams.has('linked_partitioning')) url.searchParams.set('linked_partitioning', '1');
    if (!url.searchParams.has('offset')) url.searchParams.set('offset', '0');
  }
  const response = await fetch(url.href, {
    headers: {
      'User-Agent': PAGE_UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.text().catch(() => '');
  if (!response.ok) {
    const detail = body.slice(0, 180).replace(/\s+/g, ' ');
    throw new Error('SoundCloud API HTTP ' + response.status + (detail ? ': ' + detail : ''));
  }
  let data;
  try { data = JSON.parse(body); } catch {
    throw new Error('SoundCloud API returned non-JSON data; the public endpoint may be blocked');
  }
  if (data?.errors?.length) {
    const detail = data.errors.map((e) => e?.error_message || e?.message).filter(Boolean).join('; ');
    throw new Error('SoundCloud API: ' + (detail || 'request failed'));
  }
  if (data?.error) {
    throw new Error('SoundCloud API: ' + String(data.error_message || data.message || data.error).slice(0, 180));
  }
  return data;
}

function collectionFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.collection)) return response.collection;
  return [];
}

function mediaKind(item, section) {
  const kind = String(item?.kind || '').toLowerCase();
  const setType = String(item?.set_type || item?.setType || '').toLowerCase();
  if (item?.is_album === true || setType === 'album' || kind === 'album') return 'album';
  if (kind === 'track' || (item?.duration != null && !Array.isArray(item?.tracks))) return 'track';
  if (kind === 'playlist' || kind === 'system-playlist' ||
      Array.isArray(item?.tracks) || Number(item?.track_count || item?.trackCount) > 0) {
    if (section === 'albums') return 'album';
    return 'playlist';
  }
  if (section === 'albums' && item?.permalink_url) return 'album';
  return null;
}

function normalizeProfileEntry(entry, section = 'all') {
  if (!entry || typeof entry !== 'object') return null;
  // Likes/reposts/activity responses may have their own activity URI as well as
  // a nested track/playlist. Prefer the actual playable resource over the wrapper.
  const candidates = [entry.track, entry.playlist, entry].filter((v) => v && typeof v === 'object');
  const candidate = candidates.find((v) => v.permalink_url) ||
    candidates.find((v) => v.url) ||
    candidates.find((v) => v.uri);
  if (!candidate) return null;

  let kind = mediaKind(candidate, section);
  if (!kind && candidate === entry.track) kind = 'track';
  if (!kind && candidate === entry.playlist) kind = section === 'albums' ? 'album' : 'playlist';
  if (!kind) return null;

  if (section === 'tracks' && kind !== 'track') return null;
  if (section === 'albums' && kind === 'track') return null;
  if (section === 'sets' && kind === 'track') return null;
  if (!['track', 'playlist', 'album'].includes(kind)) return null;

  const rawUrl = String(candidate.permalink_url || candidate.url || candidate.uri || '').trim();
  let url;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) ||
        !['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com',
          'api.soundcloud.com', 'api-v2.soundcloud.com'].includes(parsed.hostname.toLowerCase())) return null;
    url = parsed.href;
  } catch { return null; }

  const fallbackUser = candidate.user?.username || entry.user?.username || '';
  const title = String(candidate.title || candidate.name || entry.title || 'Untitled').trim();
  return {
    key: url.toLowerCase(),
    url,
    title: title || 'Untitled',
    band: String(fallbackUser),
    kind,
    createdAt: String(entry.created_at || candidate.created_at || ''),
  };
}

async function fetchProfileCollection(profileUrl, { limit = 10 } = {}) {
  const profile = parseProfileUrl(profileUrl);
  if (!profile) {
    throw new Error('Use a SoundCloud profile page like /username/tracks, /username/albums, /username/likes, /username/reposts or /username/sets.');
  }

  const maxItems = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));
  const pageHtml = await fetchText(profile.pageUrl, 20000, PAGE_ACCEPT);
  const clientId = await clientIdFromPage(pageHtml, profile.pageUrl);

  const resolvedUrl = new URL('resolve', API_BASE);
  resolvedUrl.searchParams.set('url', profile.profileUrl);
  const user = await requestJson(resolvedUrl.href, clientId, { list: false });
  if (!user || !user.id || String(user.kind || 'user').toLowerCase() !== 'user') {
    throw new Error('SoundCloud did not resolve this URL to a public user profile');
  }

  let nextUrl = endpointForProfile(user.id, profile.section);
  const items = [];
  const seen = new Set();
  let pages = 0;
  let truncated = false;
  const visited = new Set();

  while (nextUrl && items.length < maxItems && pages < MAX_API_PAGES) {
    const requestUrl = assertApiUrl(nextUrl).href;
    if (visited.has(requestUrl)) break;
    visited.add(requestUrl);
    const response = await requestJson(requestUrl, clientId);
    pages += 1;

    for (const entry of collectionFromResponse(response)) {
      const item = normalizeProfileEntry(entry, profile.section);
      if (!item || seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
      if (items.length >= maxItems) break;
    }

    nextUrl = Array.isArray(response) ? null : (response?.next_href || null);
    if (items.length >= maxItems) break;
  }
  if (nextUrl && items.length < maxItems && pages >= MAX_API_PAGES) truncated = true;

  if (!items.length) {
    throw new Error('The SoundCloud ' + profile.sectionLabel.toLowerCase() +
      ' page returned no public playable tracks or playlists. Check that the page is public and try again.');
  }

  const warning = truncated
    ? 'SoundCloud pagination limit reached; only the first ' + items.length + ' playable items were loaded.'
    : null;
  return {
    profile,
    user: {
      id: String(user.id),
      username: String(user.username || profile.username),
      name: String(user.full_name || user.username || profile.username),
    },
    section: profile.section,
    sectionLabel: profile.sectionLabel,
    items,
    warning,
  };
}

module.exports = {
  parseProfileUrl,
  endpointForProfile,
  extractClientId,
  extractScriptUrls,
  collectionFromResponse,
  normalizeProfileEntry,
  fetchProfileCollection,
};
