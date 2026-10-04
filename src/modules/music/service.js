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
  const info = item.info || item; // lavalink-client кладёт поля в info.* (duration, не length!)
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
  const q = resolveSearchQuery(query);
  // Spotify выключен на ноде (нет Premium у приложения): отвечаем сразу и понятно,
  // а не туманным "No results" после таймаутов.
  if (q.engine === 'spotify') {
    throw new Error('Spotify временно выключен: у Spotify-приложения нет Premium. Ищи текстом (YouTube/SoundCloud) или кинь прямую ссылку на трек.');
  }
  // ETA: сколько дослушать до нашего трека (остаток текущего + очередь ДО добавления)
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
    // 0 = играет сейчас, N = номер в upcoming (1-based, как в /queue)
    position: !result?.position ? '▶ сейчас' : `#${result.position} в очереди`,
    nextTitle,
    waitMs: etaMs,
  };
}

// Fan-коллекция Bandcamp: пачка альбомов/треков из купленного -> в очередь.
// Возвращает { fan, added: [{band, title, kind, count}], failed, totalTracks }.
async function playFan(client, voiceChannel, fanUrl, { requester, textChannel, limit = 10, onProgress } = {}) {
  const engine = eng(client);
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
  // Стартуем, если тихо
  try {
    const p = engine.getPlayer(voiceChannel.guild.id);
    if (p && !p.playing && !p.paused) await p.play().catch(() => {});
  } catch {}
  if (!added.length) throw new Error('Ничего не добавилось (все релизы недоступны)');
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
};
