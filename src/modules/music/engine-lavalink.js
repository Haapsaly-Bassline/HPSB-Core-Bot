// Lavalink music engine -- the only one in bot (legacy removed).
// Handles voice, queue, and resolution of all sources via node.

const { LavalinkManager } = require('lavalink-client');
const { logger } = require('../../utils/logger');

const LOOP_MAP = { 0: 'off', 1: 'track', 2: 'queue' };
const LOOP_BACK = { off: 0, track: 1, queue: 2 };

// search source for Lavalink per our engine.
// URLs and ready prefixes (dzsearch:, spsearch: ...) go to node as-is.
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
    case 'audiomack': return q; // URL already passed above; no prefix text for audiomack
    default: return `ytsearch:${q}`; // default -- YouTube (works as of 2026-10-04)
  }
}

class LavalinkEngine {
  constructor(client, musicCfg) {
    this.client = client;
    this.cfg = musicCfg;
    this.manager = null;
    this.speakerStatus = new Map(); // guildId -> { ok, reason, message, at } (stage)
  }

  getSpeakerStatus(guildId) {
    return this.speakerStatus.get(guildId) || null;
  }

  async init() {
    if (!this.client.user) {
      throw new Error('[lavalink] client.user is still null -- init() can only be called AFTER ready (client ready event)');
    }
    const lav = this.cfg.lavalink || {};
    const host = String(lav.host || '').trim();
    const port = Number(lav.port);
    const password = String(lav.password ?? '');
    const secure = !!lav.secure;
    if (!host) {
      throw new Error('[lavalink] LAVALINK_HOST empty -- set in .env (usually 127.0.0.1)');
    }
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`[lavalink] LAVALINK_PORT invalid (${lav.port}) -- set in .env (usually 2333)`);
    }
    if (!password.length) {
      // lavalink-client throws cryptic
      // "ManagerOption.nodes must be an Array..." in this case, so we validate ourselves with clear text.
      throw new Error('[lavalink] LAVALINK_PASSWORD empty -- set in .env the same password as in lavalink/application.yml -> lavalink.server.password');
    }
    this.manager = new LavalinkManager({
      // requestTimeout 30s: ytdlp resolve of direct YT links takes ~13s (process spawn),
      // default timeout aborted such requests "operation aborted due to timeout".
      nodes: [{ host, port, authorization: password, secure, id: 'hpsb-main', requestTimeout: 30000, requestSignalTimeoutMS: 30000 }],
      sendToShard: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        if (guild?.shard) guild.shard.send(payload);
      },
      // client.id will be set in init() below -- in constructor user may still be null
      client: { id: this.client.user.id, username: this.client.user.username || this.client.user.tag },
      autoSkip: true,
      autoSkipOnResolveError: true,
    });

    this._rawHandler = (d) => { this.manager.sendRawData(d).catch(() => {}); };
    this.client.on('raw', this._rawHandler);

    // Without these handlers node crash brings down ENTIRE process (unhandled 'error')
    this.manager.nodeManager.on('error', (this._hNodeError = (node, err) => {
      logger.warn('[lavalink] node error', node?.options?.id || node?.id || '', err?.message || 'connection failed, retrying');
    }));
    if (typeof this.manager.on === 'function') {
      this.manager.on('error', (this._hManagerError = (err) => logger.warn('[lavalink] manager error', err?.message || err)));
    }

    this.manager.on('trackStart', (this._hTrackStart = (player, track) => this.onTrackStart(player, track).catch(() => {})));
    this.manager.on('trackError', (this._hTrackError = (player, track, payload) => {
      logger.warn('[lavalink] trackError', track?.info?.title || '', JSON.stringify(payload?.exception || {}).slice(0, 200));
    }));
    this.manager.on('trackStuck', (this._hTrackStuck = (player, track) => {
      logger.warn('[lavalink] trackStuck', track?.info?.title || '');
    }));
    this.manager.on('queueEnd', (this._hQueueEnd = (player) => {
      // Queue ended -- kill NP, drop stale stage status, and leave voice
      // (no eternal idle bot).
      try { this.speakerStatus?.delete(player.guildId); } catch {}
      try { require('./np').finalize(this.client, player.guildId, 'Queue finished').catch(() => {}); } catch {}
      try { player.destroy().catch(() => {}); } catch {}
    }));

    await this.manager.init({ id: this.client.user.id, username: this.client.user.username || this.client.user.tag });
    logger.info('[lavalink] engine ready');
    return this;
  }

  getPlayer(guildId) {
    return this.manager?.getPlayer(guildId) || null;
  }

  // Detach from client (for music module stop/restart -- avoids duplicate raw listeners).
  // Removes every listener added in init(): raw + node/manager errors + track handlers.
  detach() {
    try {
      if (this._rawHandler) this.client.removeListener('raw', this._rawHandler);
      if (this._hNodeError && this.manager?.nodeManager) this.manager.nodeManager.removeListener?.('error', this._hNodeError);
      if (this._hManagerError && this.manager) this.manager.removeListener?.('error', this._hManagerError);
      for (const [ev, h] of [['trackStart', this._hTrackStart], ['trackError', this._hTrackError], ['trackStuck', this._hTrackStuck], ['queueEnd', this._hQueueEnd]]) {
        if (h && this.manager) this.manager.removeListener?.(ev, h);
      }
    } catch {}
    this._rawHandler = this._hNodeError = this._hManagerError = null;
    this._hTrackStart = this._hTrackError = this._hTrackStuck = this._hQueueEnd = null;
  }

  // True when at least one node has a live websocket. manager.init() does NOT
  // throw when the node is unreachable (it just logs), so check this explicitly
  // or users get cryptic "No available Node was found" from deep inside the client.
  available() {
    try {
      const nodes = [...(this.manager?.nodeManager?.nodes?.values?.() || [])];
      return nodes.some((n) => { try { return !!n.connected; } catch { return false; } });
    } catch { return false; }
  }

  async ensurePlayer(voiceChannel, textChannelId) {
    let player = this.getPlayer(voiceChannel.guild.id);
    let isNew = false;
    if (!player) {
      player = this.manager.createPlayer({
        guildId: voiceChannel.guild.id,
        voiceChannelId: voiceChannel.id,
        textChannelId,
        volume: 100,
        selfDeaf: true,
        selfMute: false,
      });
      isNew = true;
      await player.connect().catch(() => {});
    } else if (player.voiceChannelId !== voiceChannel.id) {
      // Bot invited to different voice -- MOVE (connect() without id change stays in old!)
      try {
        await player.changeVoiceState({ voiceChannelId: voiceChannel.id });
      } catch {
        await player.connect().catch(() => {});
      }
      isNew = true; // new channel -- request speaker again
    } else {
      await player.connect().catch(() => {});
    }
    // Stage: request speaker immediately, otherwise bot is muted listener (suppress)
    if (voiceChannel?.type === 13) {
      try {
        const { becomeSpeaker } = require('./stage');
        // Discord applies voice state not instantly -- on fresh join give it time to settle
        if (isNew) await new Promise((r) => setTimeout(r, 1500));
        const res = await becomeSpeaker(this.client, voiceChannel.guild.id, voiceChannel.id, { force: isNew });
        this.speakerStatus.set(voiceChannel.guild.id, { ...res, at: Date.now() });
      } catch (e) {
        this.speakerStatus.set(voiceChannel.guild.id, { ok: false, reason: 'error', message: e?.message });
      }
    }
    return player;
  }

  // setData in client -- ONLY key/value (single object argument silently lost!).
  setPlayerMeta(player, { requester, radioLabel } = {}, keepRadioLabel = false) {
    try {
      const prev = (typeof player.getAllData === 'function' ? player.getAllData() : {}) || {};
      player.setData('requesterId', requester?.id || null);
      player.setData('requesterTag', requester?.tag || null);
      player.setData('radioLabel', keepRadioLabel ? (prev.radioLabel || radioLabel || null) : (radioLabel || null));
    } catch {}
  }

  playerData(player) {
    try {
      if (player && typeof player.getAllData === 'function') return player.getAllData() || {};
    } catch {}
    return {};
  }

// query: URL or text; engine: 'youtube'|'soundcloud'|'spotify'|'arbitrary'|'deezer'|...
// arbitrary (direct mp3/radio) passed to node as-is.
  async play(voiceChannel, query, { requester, metadata = {}, engine = 'youtube' } = {}) {
    // Remember where we were: ensurePlayer MOVES the bot before the search,
    // so on a failed lookup we move back instead of stranding live audio
    // from guild A into channel B.
    const prevVoice = this.getPlayer(voiceChannel.guild.id)?.voiceChannelId || null;
    const player = await this.ensurePlayer(voiceChannel, metadata.channel?.id);
    const q = engine === 'arbitrary' ? query : searchSource(engine, query);
    // IMPORTANT: source specified EXPLICITLY. Without it lavalink-client substitutes
    // defaultSearchPlatform='ytsearch', and with YouTube disabled ANY
    // link FAILS ("has not 'youtube' enabled"), even though node resolves it. Verified 2026-10-03.
    const src = searchParamSource(engine, q);
    const res = await player.search({ query: q, source: src }, requester).catch((e) => {
      logger.warn('[lavalink] search failed', String(e?.message || e).slice(0, 160));
      return null;
    });
    if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
      // Don't strand an empty bot in voice on a failed lookup. If we moved an
      // already-playing player here, move it back where the audio belongs.
      try {
        if (!player.queue?.current && !player.queue?.tracks?.length) {
          if (prevVoice && prevVoice !== voiceChannel.id) {
            await player.changeVoiceState({ voiceChannelId: prevVoice }).catch(() => {});
          } else {
            await player.destroy().catch(() => {});
          }
        }
      } catch {}
      throw new Error(`No results for "${String(query).slice(0, 120)}"`);
    }
    this.setPlayerMeta(player, { requester, radioLabel: metadata.radioLabel || null });
    // position in upcoming BEFORE addition (0 = playing now)
    const upcomingBefore = player.queue.tracks.length;
    const wasIdle = !player.playing && !player.paused;
    const position = wasIdle && upcomingBefore === 0 ? 0 : upcomingBefore + 1;

    if (res.loadType === 'playlist') {
      await player.queue.add(res.tracks);
      if (wasIdle) await player.play().catch(() => {});
      return { track: viewOf(res.tracks[0], requester), queue: player.queue, playlist: { title: res.playlist?.name || res.playlist?.title, count: res.tracks.length }, position };
    }
    const track = res.tracks[0];
    await player.queue.add(track);
    if (wasIdle) await player.play().catch(() => {});
    return { track: viewOf(track, requester), queue: player.queue, playlist: null, position };
  }

// Add SINGLE URL to queue without auto-start externally (for batches: fan collections etc.).
// Returns { loadType, count, title }. Resolve errors thrown outward.
  async enqueueUrl(voiceChannel, url, { requester, metadata = {} } = {}) {
    const prevVoice = this.getPlayer(voiceChannel.guild.id)?.voiceChannelId || null;
    const player = await this.ensurePlayer(voiceChannel, metadata.channel?.id);
    const src = urlSource(String(url));
    const res = await player.search({ query: String(url), source: src }, requester).catch((e) => {
      logger.warn('[lavalink] search failed', String(e?.message || e).slice(0, 160));
      return null;
    });
    if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
      try {
        if (!player.queue?.current && !player.queue?.tracks?.length) {
          if (prevVoice && prevVoice !== voiceChannel.id) {
            await player.changeVoiceState({ voiceChannelId: prevVoice }).catch(() => {});
          } else {
            await player.destroy().catch(() => {});
          }
        }
      } catch {}
      throw new Error(`No results for "${String(url).slice(0, 120)}"`);
    }
    // setData -- only key/value; fan tracks are NOT radio: clear any stale label.
    this.setPlayerMeta(player, { requester, radioLabel: null }, false);
    await player.queue.add(res.tracks);
    const title = res.loadType === 'playlist'
      ? (res.playlist?.name || res.playlist?.title || 'playlist')
      : (res.tracks[0]?.info?.title || 'Unknown');
    return { loadType: res.loadType, count: res.tracks.length, title };
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

// --- Control (names match commands) ---
// All methods do NOT throw outward: false/null = "nothing to do", commands show clean responses.
// skip(amount): skip N tracks (1 = current). throwError=false: skip of last
// track STOPS it, doesn't throw RangeError. Returns number skipped or false.
  async skip(guildId, amount = 1) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    const avail = (p.queue.current ? 1 : 0) + p.queue.tracks.length;
    if (!avail) return false;
    const n = Math.max(1, Math.min(Math.floor(Number(amount) || 1), avail));
    try { await p.skip(n, false); return n; }
    catch { return false; }
  }
  async stop(guildId) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    await p.destroy().catch(() => {});
    this.speakerStatus?.delete(guildId);
    return true;
  }
  async pause(guildId, state = true) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    const want = state !== false;
    if (!!p.paused === want) return true; // already in desired state (client throws on repeat!)
    try { want ? await p.pause() : await p.resume(); return true; }
    catch { return false; }
  }
  async seek(guildId, ms) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    const cur = p.queue?.current;
    // streams/unseekable client throws RangeError -- we return false instead of exception
    if (!cur || cur.info?.isStream || cur.info?.isSeekable === false) return false;
    try { await p.seek(ms); return true; }
    catch { return false; }
  }
  async volume(guildId, vol) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    try { await p.setVolume(vol); return true; }
    catch { return false; }
  }
  async loop(guildId, modeNum) {
    const p = this.getPlayer(guildId);
    if (!p) return false;
    try { await p.setRepeatMode(LOOP_MAP[modeNum] || 'off'); return true; }
    catch { return false; }
  }
  async shuffle(guildId) {
    const p = this.getPlayer(guildId);
    if (!p || !p.queue.tracks.length) return false;
    try { await p.queue.shuffle(); return true; }
    catch { return false; }
  }
  async clear(guildId) {
    const p = this.getPlayer(guildId);
    if (!p || !p.queue.tracks.length) return false;
    try { await p.queue.splice(0, p.queue.tracks.length); return true; } // official splice (store sync!)
    catch { return false; }
  }
  async remove(guildId, index) {
    const p = this.getPlayer(guildId);
    if (!p || index < 0 || index >= p.queue.tracks.length) return null;
    const title = p.queue.tracks[index]?.info?.title || 'Unknown';
    try { await p.queue.splice(index, 1); return { title }; }
    catch { return null; }
  }
  async move(guildId, from, to) {
    const p = this.getPlayer(guildId);
    if (!p || from < 0 || from >= p.queue.tracks.length || to < 0 || to >= p.queue.tracks.length) return false;
    try {
      const t = p.queue.tracks[from];
      await p.queue.splice(from, 1);
      await p.queue.splice(to, 0, t);
      return true;
    } catch { return false; }
  }

  // Full view for /queue and live NP (durations in ms for bar)
  queueViewFull(guildId) {
    const p = this.getPlayer(guildId);
    if (!p || !p.queue?.current) return null;
    const data = this.playerData(p);
    const cur = infoMs(p.queue.current);
    if (data.radioLabel) cur.title = `📻 ${data.radioLabel}`;
    cur.requesterTag = data.requesterTag || null;
    const upcoming = p.queue.tracks.slice(0, 15).map((t, i) => ({ n: i + 1, ...infoMs(t) }));
    const pos = p.position ?? 0;
    const remaining = cur.durationMs > 0 ? Math.max(cur.durationMs - pos, 0) : 0;
    const totalMs = remaining + p.queue.tracks.reduce((a, t) => a + trackLenMs(t?.info || t), 0);
    return {
      current: cur, upcoming, size: p.queue.tracks.length, totalMs,
      repeatMode: LOOP_BACK[p.repeatMode] ?? 0, paused: !!p.paused,
    };
  }

  npSnapshot(guildId) {
    const v = this.queueViewFull(guildId);
    if (!v) return null;
    const data = this.playerData(this.getPlayer(guildId));
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
      // Pop from history first: re-inserting without removing duplicates the
      // entry, and the next /prev returns the same track again.
      try { prevArr.pop(); } catch {}
      await p.queue.splice(0, 0, t);
      return await this.skip(guildId);
    } catch { return false; }
  }
}

function trackLenMs(info) {
// Server sends length, lavalink-client rebuilds into duration, flat views -- durationMs.
// Verified 2026-10-04: client tracks have ONLY duration (length=undefined!).
  for (const k of ['length', 'duration', 'durationMs']) {
    const v = Number(info?.[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// Flat track view for /play responses (client returns nested info.*,
// service.viewOf would show as Unknown -- verified 2026-10-04).
function viewOf(t, requester) {
  const v = infoMs(t);
  v.requesterTag = requester?.tag || null;
  return v;
}

function infoMs(t) {
  const info = t?.info || t || {};
  const ms = trackLenMs(info);
  return {
    title: info.title || 'Unknown', author: info.author || '',
    url: info.uri || info.url || '', thumbnail: info.artworkUrl || info.thumbnail || '',
    durationMs: ms, durationLabel: info.isStream || ms <= 0 ? 'LIVE' : fmtDur(ms),
    requesterTag: null, isLive: !!info.isStream || ms <= 0,
    source: normSource(info.sourceName || info.source || t?.source || ''),
  };
}

// source for player.search: derive from query itself (prefix/domain),
// not from client's defaultSearchPlatform (there ytsearch -- dead without YouTube).
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
    default: return 'ytsearch'; // default -- YouTube (works as of 2026-10-04)
  }
}

// Canonical Lavalink source names for URL (match node's sourceManagers).
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
  return 'http'; // direct mp3/radio and everything unknown
}

// Lavalink sourceName -> short source code for overlay badges
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
