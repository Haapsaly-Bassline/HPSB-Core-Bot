// MusicService — единая точка входа музыки. ТОЛЬКО Lavalink (legacy hpsb engine удалён).
// Формы ответов стабильны — команды и NP строят оверлеи поверх них.
const { resolveSearchQuery } = require('./resolvers');
const { fmtMs } = require('../../utils/music');

function eng(client) {
  const e = client.music;
  if (!e || typeof e.play !== 'function') throw new Error('Music engine не инициализирован (Lavalink не подключён)');
  return e;
}

function viewOf(item) {
  if (!item) return null;
  const info = item.info || item; // lavalink-client кладёт поля в info.*
  const ms = info.length > 0 ? info.length : (info.durationMs || item.durationMs || 0);
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

function formatDuration(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

async function play(client, voiceChannel, query, { requester, textChannel, radioLabel } = {}) {
  const engine = eng(client);
  const q = resolveSearchQuery(query);
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
    position: '▶ сейчас',
    nextTitle: null,
    waitMs: 0,
  };
}

module.exports = {
  engineName: () => 'lavalink',

  play,

  skip: (client, guildId) => eng(client).skip(guildId),
  stop: async (client, guildId) => { await eng(client).stop(guildId); return true; },
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
  formatDuration,
};
