// Lavalink-движок музыки (включается на host PC: MUSIC_ENGINE=lavalink).
// Зеркалит поведение discord-player-пути: те же эмбеды Now Playing / Added Track.
// Живое тестирование звука — только на host PC (там рабочий UDP).

const { LavalinkManager } = require('lavalink-client');
const { logger } = require('../../utils/logger');

const LOOP_MAP = { 0: 'off', 1: 'track', 2: 'queue' };
const LOOP_BACK = { off: 0, track: 1, queue: 2 };

// источник поиска Lavalink по нашему движку.
// URL и готовые префиксы (dzsearch:, spsearch: …) уходят ноде как есть.
const KNOWN_PREFIXES = /^(ytsearch|ytmsearch|scsearch|spsearch|dzsearch|dzisrc|amsearch|tdsearch|qbsearch|qbisrc|ymsearch|vksearch):/i;
function searchSource(engine, query) {
  const q = String(query || '');
  if (/^https?:\/\//i.test(q) || KNOWN_PREFIXES.test(q)) return q;
  switch (engine) {
    case 'soundcloud': return `scsearch:${q}`;
    case 'spotify': return `spsearch:${q}`;
    case 'deezer': return `dzsearch:${q}`;
    case 'applemusic': return `amsearch:${q}`;
    case 'tidal': return `tdsearch:${q}`;
    case 'qobuz': return `qbsearch:${q}`;
    case 'yandex': return `ymsearch:${q}`;
    case 'vk': return `vksearch:${q}`;
    case 'audiomack': return q; // URL уже прошёл выше; текста без префикса у audiomack нет
    default: return `ytsearch:${q}`; // дефолт — YouTube (работает с 2026-10-04)
  }
}

class LavalinkEngine {
  constructor(client, musicCfg) {
    this.client = client;
    this.cfg = musicCfg;
    this.manager = null;
  }

  async init() {
    if (!this.client.user) {
      throw new Error('[lavalink] client.user ещё null — init() можно вызывать только ПОСЛЕ ready (client ready event)');
    }
    const lav = this.cfg.lavalink || {};
    const host = String(lav.host || '').trim();
    const port = Number(lav.port);
    const password = String(lav.password ?? '');
    const secure = !!lav.secure;
    if (!host) {
      throw new Error('[lavalink] LAVALINK_HOST пуст — впиши в .env (обычно 127.0.0.1)');
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`[lavalink] LAVALINK_PORT кривой (${lav.port}) — впиши в .env (обычно 2333)`);
    }
    if (!password.length) {
      // lavalink-client в этом случае кидает криптичное
      // "ManagerOption.nodes must be an Array...", поэтому валидируем сами с понятным текстом.
      throw new Error('[lavalink] LAVALINK_PASSWORD пуст — впиши в .env тот же пароль, что в lavalink/application.yml -> lavalink.server.password');
    }
    this.manager = new LavalinkManager({
      nodes: [{ host, port, authorization: password, secure, id: 'hpsb-main' }],
      sendToShard: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        if (guild?.shard) guild.shard.send(payload);
      },
      // client.id подставим в init() ниже — в конструкторе user может быть ещё null
      client: { id: this.client.user.id, username: this.client.user.username || this.client.user.tag },
      autoSkip: true,
      autoSkipOnResolveError: true,
    });

    this.client.on('raw', (d) => { this.manager.sendRawData(d).catch(() => {}); });

    // Без этих хендлеров падение ноды роняет ВЕСЬ процесс (unhandled 'error')
    this.manager.nodeManager.on('error', (node, err) => {
      logger.warn('[lavalink] node error', node?.options?.id || node?.id || '', err?.message || 'connection failed, retrying');
    });
    if (typeof this.manager.on === 'function') {
      this.manager.on('error', (err) => logger.warn('[lavalink] manager error', err?.message || err));
    }

    this.manager.on('trackStart', (player, track) => this.onTrackStart(player, track).catch(() => {}));
    this.manager.on('trackError', (player, track, payload) => {
      logger.warn('[lavalink] trackError', track?.info?.title || '', JSON.stringify(payload?.exception || {}).slice(0, 200));
    });
    this.manager.on('trackStuck', (player, track) => {
      logger.warn('[lavalink] trackStuck', track?.info?.title || '');
    });

    await this.manager.init({ id: this.client.user.id, username: this.client.user.username || this.client.user.tag });
    logger.info('[lavalink] engine ready');
    return this;
  }

  getPlayer(guildId) {
    return this.manager?.getPlayer(guildId) || null;
  }

  async ensurePlayer(voiceChannel, textChannelId) {
    let player = this.getPlayer(voiceChannel.guild.id);
    if (!player) {
      player = this.manager.createPlayer({
        guildId: voiceChannel.guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId,
        volume: 100,
        selfDeaf: true,
        selfMute: false,
      });
    } else if (player.voiceChannelId !== voiceChannel.id) {
      await player.connect().catch(() => {});
    }
    await player.connect().catch(() => {});
    return player;
  }

  // query: URL или текст; engine: 'youtube'|'soundcloud'|'spotify'|'arbitrary'|'deezer'|…
  // arbitrary (прямые mp3/радио) отдаём ноде как есть.
  async play(voiceChannel, query, { requester, metadata = {}, engine = 'youtube' } = {}) {
    const player = await this.ensurePlayer(voiceChannel, metadata.channel?.id);
    const q = engine === 'arbitrary' ? query : searchSource(engine, query);
    // ВАЖНО: source указываем ЯВНО. Без него lavalink-client подставляет
    // defaultSearchPlatform='ytsearch', и при выключенном YouTube ВАЛИТСЯ ЛЮБАЯ
    // ссылка ("has not 'youtube' enabled"), хотя нода её резолвит. Проверено 2026-10-03.
    const src = searchParamSource(engine, q);
    const res = await player.search({ query: q, source: src }, requester).catch((e) => {
      logger.warn('[lavalink] search failed', String(e?.message || e).slice(0, 160));
      return null;
    });
    if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
      throw new Error(`No results for "${String(query).slice(0, 120)}"`);
    }
    player.setData({ requesterId: requester?.id || null, requesterTag: requester?.tag || null, radioLabel: metadata.radioLabel || null });

    if (res.loadType === 'playlist') {
      await player.queue.add(res.tracks);
      if (!player.playing && !player.paused) await player.play().catch(() => {});
      return { track: viewOf(res.tracks[0], requester), queue: player.queue, playlist: { title: res.playlist?.name || res.playlist?.title, count: res.tracks.length } };
    }
    const track = res.tracks[0];
    await player.queue.add(track);
    if (!player.playing && !player.paused) await player.play().catch(() => {});
    return { track: viewOf(track, requester), queue: player.queue, playlist: null };
  }

  async onTrackStart(player, track) {
    try {
      const np = require('./np');
      const ch = player.textChannelId
        ? await this.client.channels.fetch(player.textChannelId).catch(() => null)
        : null;
      await np.trackStart(this.client, player.guildId, ch?.isTextBased?.() ? ch : null);
    } catch (e) { logger.warn('[lavalink] nowplaying failed', e.message); }
  }

  // --- Управление (имена как в командах) ---
  skip(guildId) { const p = this.getPlayer(guildId); if (!p) return false; return p.skip() != null; }
  async stop(guildId) { const p = this.getPlayer(guildId); if (!p) return; await p.destroy().catch(() => {}); }
  async pause(guildId, state = true) { const p = this.getPlayer(guildId); if (!p) return false; state ? await p.pause() : await p.resume(); return true; }
  async seek(guildId, ms) { const p = this.getPlayer(guildId); if (!p) return false; await p.seek(ms); return true; }
  async volume(guildId, vol) { const p = this.getPlayer(guildId); if (!p) return false; await p.setVolume(vol); return true; }
  async loop(guildId, modeNum) { const p = this.getPlayer(guildId); if (!p) return false; await p.setRepeatMode(LOOP_MAP[modeNum] || 'off'); return true; }
  async shuffle(guildId) { const p = this.getPlayer(guildId); if (!p || !p.queue.tracks.length) return false; await p.queue.shuffle(); return true; }
  async clear(guildId) { const p = this.getPlayer(guildId); if (!p) return false; p.queue.tracks.length = 0; return true; }
  async remove(guildId, index) {
    const p = this.getPlayer(guildId);
    if (!p || index < 0 || index >= p.queue.tracks.length) return null;
    const [t] = p.queue.tracks.splice(index, 1);
    return t || null;
  }
  async move(guildId, from, to) {
    const p = this.getPlayer(guildId);
    if (!p || from < 0 || from >= p.queue.tracks.length || to < 0 || to >= p.queue.tracks.length) return false;
    const [t] = p.queue.tracks.splice(from, 1);
    p.queue.tracks.splice(to, 0, t);
    return true;
  }
  queueInfo(guildId) {
    const p = this.getPlayer(guildId);
    if (!p) return null;
    return {
      current: p.queue.current ? infoOf(p.queue.current) : null,
      upcoming: p.queue.tracks.map(infoOf).slice(0, 15),
      size: p.queue.tracks.length,
      repeatMode: LOOP_BACK[p.repeatMode] ?? 0,
      position: p.position ?? 0,
    };
  }

  // Полный вью для /queue и живого NP (длительности в ms для бара)
  queueViewFull(guildId) {
    const p = this.getPlayer(guildId);
    if (!p || !p.queue?.current) return null;
    const data = p.getData?.() || {};
    const cur = infoMs(p.queue.current);
    if (data.radioLabel) cur.title = `📻 ${data.radioLabel}`;
    cur.requesterTag = data.requesterTag || null;
    const upcoming = p.queue.tracks.slice(0, 15).map((t, i) => ({ n: i + 1, ...infoMs(t) }));
    const totalMs = cur.durationMs + p.queue.tracks.reduce((a, t) => a + (t?.info?.length > 0 ? t.info.length : 0), 0);
    return {
      current: cur, upcoming, size: p.queue.tracks.length, totalMs,
      repeatMode: LOOP_BACK[p.repeatMode] ?? 0, paused: !!p.paused,
    };
  }

  npSnapshot(guildId) {
    const v = this.queueViewFull(guildId);
    if (!v) return null;
    const data = this.getPlayer(guildId)?.getData?.() || {};
    return {
      track: v.current, positionMs: this.getPlayer(guildId)?.position ?? 0,
      durationMs: v.current.durationMs, repeatMode: v.repeatMode,
      paused: v.paused, size: v.size, radioLabel: data.radioLabel || null,
    };
  }

  async prev(guildId) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    try {
      const prevArr = Array.isArray(p.queue.previous) ? p.queue.previous : null;
      const t = prevArr?.length ? prevArr[prevArr.length - 1] : null;
      if (!t) return false;
      p.queue.tracks.splice(0, 0, t);
      await p.skip();
      return true;
    } catch { return false; }
  }
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function infoOf(t) {
  const info = t?.info || t || {};
  return {
    title: info.title || 'Unknown', author: info.author || '', url: info.uri || info.url || '',
    duration: info.isStream ? 'LIVE' : fmtDur(info.length),
    source: normSource(info.sourceName || info.source || t?.source || ''),
  };
}

// Плоский вью трека для ответов /play (клиент отдаёт вложенный info.*,
// service.viewOf его бы показал как Unknown — проверено 2026-10-04).
function viewOf(t, requester) {
  const v = infoMs(t);
  v.requesterTag = requester?.tag || null;
  return v;
}

function infoMs(t) {
  const info = t?.info || t || {};
  const ms = info.length > 0 ? info.length : (info.durationMs || 0);
  return {
    title: info.title || 'Unknown', author: info.author || '',
    url: info.uri || info.url || '', thumbnail: info.artworkUrl || info.thumbnail || '',
    durationMs: ms, durationLabel: info.isStream || ms <= 0 ? 'LIVE' : fmtDur(ms),
    requesterTag: null, isLive: !!info.isStream || ms <= 0,
    source: normSource(info.sourceName || info.source || t?.source || ''),
  };
}

// source для player.search: выводим из самого запроса (префикс/домен),
// а не из defaultSearchPlatform клиента (там ytsearch — мёртв без YouTube).
function searchParamSource(engine, q) {
  const query = String(q || '');
  const pref = query.match(/^(ytsearch|ytmsearch|scsearch|spsearch|dzsearch|dzisrc|amsearch|tdsearch|qbsearch|qbisrc|ymsearch|vksearch):/i);
  if (pref) return pref[1].toLowerCase();
  if (/^https?:\/\//i.test(query)) return urlSource(query);
  switch (engine) {
    case 'soundcloud': return 'scsearch';
    case 'spotify': return 'spsearch';
    case 'deezer': return 'dzsearch';
    case 'applemusic': return 'amsearch';
    case 'tidal': return 'tdsearch';
    case 'qobuz': return 'qbsearch';
    case 'yandex': return 'ymsearch';
    case 'vk': return 'vksearch';
    default: return 'ytsearch'; // дефолт — YouTube (работает с 2026-10-04)
  }
}

// Каноничные имена источников Lavalink для URL (совпадают с sourceManagers ноды).
function urlSource(url) {
  const v = String(url || '').toLowerCase();
  if (/soundcloud\.com|on\.soundcloud/.test(v)) return 'soundcloud';
  if (/spotify\.com/.test(v)) return 'spotify';
  if (/deezer\.com|deezer\.page\.link/.test(v)) return 'deezer';
  if (/music\.apple\.com/.test(v)) return 'applemusic';
  if (/tidal\.com/.test(v)) return 'tidal';
  if (/qobuz\.com|open\.qobuz|play\.qobuz/.test(v)) return 'qobuz';
  if (/music\.yandex|yandex\..*music/.test(v)) return 'yandexmusic';
  if (/vk\.com|vk\.ru/.test(v)) return 'vkmusic';
  if (/bandcamp\.com/.test(v)) return 'bandcamp';
  if (/youtube\.com|youtu\.be/.test(v)) return 'youtube';
  return 'http'; // прямые mp3/радио и всё неизвестное
}

// Lavalink sourceName -> короткий код источника для бейджей оверлея
function normSource(s) {
  const v = String(s || '').toLowerCase();
  if (!v) return '';
  if (v.includes('spotify')) return 'spotify';
  if (v.includes('apple')) return 'applemusic';
  if (v.includes('deezer')) return 'deezer';
  if (v.includes('tidal')) return 'tidal';
  if (v.includes('qobuz')) return 'qobuz';
  if (v.includes('yandex')) return 'yandex';
  if (v.includes('vk')) return 'vk';
  if (v.includes('soundcloud')) return 'soundcloud';
  if (v.includes('bandcamp')) return 'bandcamp';
  if (v.includes('vimeo')) return 'vimeo';
  if (v.includes('twitch')) return 'twitch';
  if (v.includes('youtube') || v.includes('yt-')) return 'youtube';
  if (v === 'http' || v.includes('http')) return 'http';
  return v.slice(0, 24);
}

module.exports = { LavalinkEngine, searchSource, searchParamSource, urlSource };
