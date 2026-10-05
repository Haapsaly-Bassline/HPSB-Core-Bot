// MusicService -- single entry point for music. Lavalink ONLY (legacy hpsb engine removed).
// Response shapes are stable -- commands and NP build overlays on top.
const { resolveSearchQuery } = require('./resolvers');
const { fmtMs } = require('../../utils/music');

function eng(client) {
  const e = client.music;
  if (!e || typeof e.play !== 'function') throw new Error('Music engine is not initialized (Lavalink is not connected)');
  return e;
}

// Actions that need a live node connection fail fast with a clear message
// instead of cryptic client internals ("No available Node was found").
function needNode(engine) {
  let ok = false;
  try { ok = typeof engine.available === 'function' ? engine.available() : true; } catch { ok = false; }
  if (!ok) throw new Error('Music unavailable: Lavalink node is not connected. Start Lavalink (java -jar Lavalink.jar in lavalink folder) and wait for "ready to accept connections", then retry. If it is running, check LAVALINK_PASSWORD.');
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
  needNode(engine);
  const q = resolveSearchQuery(query);
// Spotify disabled on node (no Premium on app): reply immediately with clear message,
// not vague "No results" after timeouts.
  if (q.engine === 'spotify') {
    throw new Error('Spotify is temporarily disabled: the Spotify app has no Premium. Search by text (YouTube/SoundCloud) or paste a direct track link.');
  }
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
  needNode(engine);
  const { fetchCollection } = require('./bandcamp-fan');
  const { fan, items } = await fetchCollection(fanUrl, { limit: Math.max(1, Math.min(25, limit || 10)) });
  const added = [];
  let failed = 0;
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
    } catch {
      failed += 1;
    }
  }
  // Start if idle
  try {
    const p = engine.getPlayer(voiceChannel.guild.id);
    if (p && !p.playing && !p.paused) await p.play().catch(() => {});
  } catch {}
  if (!added.length) throw new Error('Nothing was added (all releases are unavailable)');
  return { fan, added, failed, totalTracks: added.reduce((a, x) => a + x.count, 0) };
}

module.exports = {
  engineName: () => 'lavalink',

  play,
  playFan,

  skip: (client, guildId, amount = 1) => eng(client).skip(guildId, amount),
  stop: async (client, guildId) => eng(client).stop(guildId),
  pause: (client, guildId, on) => eng(client).pause(guildId, on !== false),
  resume: (client, guildId) => eng(client).pause(guildId, false),
  seek: (client, guildId, ms) => eng(client).seek(guildId, ms),
  volume: (client, guildId, vol) => eng(client).volume(guildId, vol),
  loop: (client, guildId, mode) => {
    const m = mode === 3 ? 0 : mode;
    return eng(client).loop(guildId, m);
  },
  shuffle: (client, guildId) => eng(client).shuffle(guildId),
  clear: (client, guildId) => eng(client).clear(guildId),
  remove: async (client, guildId, idx) => {
    const t = await eng(client).remove(guildId, idx);
    return t ? { title: t?.info?.title || t?.title || 'Unknown' } : null;
  },
  move: (client, guildId, from, to) => eng(client).move(guildId, from, to),
  prev: (client, guildId) => eng(client).prev(guildId),

  queueView: (client, guildId) => eng(client).queueViewFull(guildId),
  npSnapshot: (client, guildId) => eng(client).npSnapshot(guildId),
  voiceChannelId: (client, guildId) => eng(client).getPlayer(guildId)?.voiceChannelId || null,
  // Join/switch voice (without music): creation and move handled in engine's ensurePlayer
  join: async (client, voiceChannel, textChannelId) => {
    const engine = eng(client);
    needNode(engine);
    await engine.ensurePlayer(voiceChannel, textChannelId || null);
    return true;
  },
  // Stage speaker status (null = not stage / not requested)
  speakerStatus: (client, guildId) => {
    const e = eng(client);
    return typeof e.getSpeakerStatus === 'function' ? e.getSpeakerStatus(guildId) : null;
  },
};
