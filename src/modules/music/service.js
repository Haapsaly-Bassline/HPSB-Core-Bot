// MusicService -- single entry point for music. Lavalink ONLY (legacy hpsb engine removed).
// Response shapes are stable -- commands and NP build overlays on top.
const { resolveSearchQuery } = require('./resolvers');
const { fmtMs } = require('../../utils/music');
const { config } = require('../../config');

// Null when the engine isn't up (client.music set in ready.js after login).
// One-liner actions below tolerate null and answer false/null so commands show
// a clean "nothing to do" instead of throwing "application did not respond".
function eng(client) {
  const e = client.music;
  if (!e || typeof e.play !== 'function') return null;
  return e;
}

// Actions that need a live node connection fail fast with a clear message
// instead of cryptic client internals ("No available Node was found").
function needNode(engine) {
  let ok = false;
  try { ok = typeof engine.available === 'function' ? engine.available() : true; } catch { ok = false; }
  if (!ok) throw new Error('Music unavailable: the Lavalink node is not connected. Check that your Lavalink server is running and that LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD / LAVALINK_SECURE in .env match it, then retry.');
}

function viewOf(item) {
  if (!item) return null;
  const info = item.info || item; // lavalink-client puts fields in info.* (duration, not length!)
  const ms = info.length > 0 ? info.length : (info.duration > 0 ? info.duration : (info.durationMs || item.durationMs || 0));
  const live = info.isStream || item.isLive || ms <= 0;
  return {
    title: info.title || item.title || 'Unknown',
    url: info.uri || info.url || item.url || '',
    author: info.author || item.author || '',
    thumbnail: info.artworkUrl || info.thumbnail || item.thumbnail || '',
    durationMs: ms,
    durationLabel: live ? 'LIVE' : fmtMs(ms),
    requesterTag: item.requesterTag || null, isLive: !!live,
    source: item.source || '',
  };
}

async function play(client, voiceChannel, query, { requester, textChannel, radioLabel } = {}) {
  const engine = eng(client);
  if (!engine) throw new Error('Music engine is not initialized yet (bot still starting) -- try again in a few seconds');
  needNode(engine);
  const q = resolveSearchQuery(query, config.music.defaultSearchSource);
  // ETA: how long until our track plays (remaining current + queue BEFORE addition)
  let etaMs = 0;
  let nextTitle = null;
  try {
    const before = engine.queueViewFull(voiceChannel.guild.id);
    if (before) {
      etaMs = before.totalMs || 0;
      nextTitle = before.size > 0 ? (before.upcoming[0]?.title || null) : null;
    }
  } catch {}
  const result = await engine.play(voiceChannel, q.query, {
    requester,
    metadata: { channel: textChannel, radioLabel: radioLabel || null },
    engine: q.engine,
  });

  return {
    kind: result?.playlist ? 'playlist' : 'track',
    track: viewOf(result?.track || null),
    playlist: result?.playlist ? {
      title: result.playlist.title || result.playlist.name || 'playlist',
      author: '',
      url: '',
      count: Number(result.playlist.count || 0),
    } : null,
    // 0 = playing now, N = position in upcoming (1-based, like /queue)
    position: !result?.position ? '▶ playing now' : `#${result.position} in queue`,
    nextTitle,
    waitMs: etaMs,
  };
}

// Bandcamp fan collection: batch of albums/tracks from purchases -> queue.
// Returns { fan, added: [{band, title, kind, count}], failed, totalTracks }.
async function playFan(client, voiceChannel, fanUrl, { requester, textChannel, limit = 10, onProgress } = {}) {
  const engine = eng(client);
  if (!engine) throw new Error('Music engine is not initialized yet (bot still starting) -- try again in a few seconds');
  needNode(engine);
  const { fetchCollection } = require('./bandcamp-fan');
  const { fan, items } = await fetchCollection(fanUrl, { limit: Math.max(1, Math.min(25, limit || 10)) });
  const added = [];
  let failed = 0;
  let firstFailure = null;
  let n = 0;
  for (const it of items) {
    n += 1;
    if (n === 1 || n % 5 === 0 || n === items.length) {
      try { await onProgress?.(n, items.length); } catch {}
    }
    try {
      const r = await engine.enqueueUrl(voiceChannel, it.url, {
        requester, metadata: { channel: textChannel },
      });
      added.push({ band: it.band, title: it.kind === 'album' ? (r.title || it.title) : it.title, kind: it.kind, count: r.count });
    } catch (error) {
      failed += 1;
      const detail = String(error?.message || error || 'unknown error').slice(0, 180);
      if (!firstFailure) firstFailure = detail;
      logger.warn('[music] Bandcamp release failed', JSON.stringify({
        title: String(it.title || 'Unknown').slice(0, 120),
        url: String(it.url || '').slice(0, 180),
        error: detail,
      }));
    }
  }
  if (!added.length) {
    const detail = firstFailure ? `; first error: ${firstFailure}` : '';
    throw new Error(`No releases were added (${failed}/${items.length} failed)${detail}`);
  }

  // Start if idle. Don't claim success if Lavalink rejected the playback start.
  const player = engine.getPlayer(voiceChannel.guild.id);
  if (player && !player.playing && !player.paused) {
    try {
      await player.play();
    } catch (error) {
      const detail = String(error?.message || error || 'unknown Lavalink error').slice(0, 180);
      logger.error('[music] Bandcamp queue loaded but playback start failed', detail);
      throw new Error(`Queued ${added.length} release(s), but playback failed to start: ${detail}`);
    }
  }
  return { fan, added, failed, totalTracks: added.reduce((a, x) => a + x.count, 0) };
}

module.exports = {
  engineName: () => 'lavalink',

  play,
  playFan,

  skip: (client, guildId, amount = 1) => eng(client)?.skip(guildId, amount) ?? false,
  stop: async (client, guildId) => eng(client)?.stop(guildId) ?? false,
  pause: (client, guildId, on) => eng(client)?.pause(guildId, on !== false) ?? false,
  resume: (client, guildId) => eng(client)?.pause(guildId, false) ?? false,
  seek: (client, guildId, ms) => eng(client)?.seek(guildId, ms) ?? false,
  volume: (client, guildId, vol) => eng(client)?.volume(guildId, vol) ?? false,
  loop: (client, guildId, mode) => {
    const m = mode === 3 ? 0 : mode;
    return eng(client)?.loop(guildId, m) ?? false;
  },
  shuffle: (client, guildId) => eng(client)?.shuffle(guildId) ?? false,
  clear: (client, guildId) => eng(client)?.clear(guildId) ?? false,
  remove: async (client, guildId, idx) => {
    const t = await eng(client)?.remove(guildId, idx);
    return t ? { title: t?.info?.title || t?.title || 'Unknown' } : null;
  },
  move: (client, guildId, from, to) => eng(client)?.move(guildId, from, to) ?? false,
  prev: (client, guildId) => eng(client)?.prev(guildId) ?? false,

  queueView: (client, guildId) => eng(client)?.queueViewFull(guildId) ?? null,
  npSnapshot: (client, guildId) => eng(client)?.npSnapshot(guildId) ?? null,
  voiceChannelId: (client, guildId) => eng(client)?.getPlayer(guildId)?.voiceChannelId || null,
  // Join/switch voice (without music): creation and move handled in engine's ensurePlayer
  join: async (client, voiceChannel, textChannelId) => {
    const engine = eng(client);
    if (!engine) throw new Error('Music engine is not initialized yet (bot still starting) -- try again in a few seconds');
    needNode(engine);
    await engine.ensurePlayer(voiceChannel, textChannelId || null);
    return true;
  },
  // Stage speaker status (null = not stage / not requested)
  speakerStatus: (client, guildId) => {
    const e = eng(client);
    return typeof e?.getSpeakerStatus === 'function' ? e.getSpeakerStatus(guildId) : null;
  },
};
