// MusicService — единая точка входа музыки. Внутри может быть Lavalink или legacy hpsb engine.
// Формы ответов как раньше — команды и NP не менялись.
const { resolve } = require('./resolvers');
const { resolveSearchQuery } = require('./resolvers');
const { fmtMs } = require('../../utils/music');

function eng(client) {
  if (!client.music) throw new Error('Music engine не инициализирован');
  return client.music;
}

function viewOf(item) {
  if (!item) return null;
  const ms = item.durationMs || 0;
  return {
    title: item.title || 'Unknown', url: item.url || '', author: item.author || '',
    thumbnail: item.thumbnail || '', durationMs: ms,
    durationLabel: ms > 0 ? fmtMs(ms) : 'LIVE',
    requesterTag: item.requesterTag || null, isLive: !!item.isLive,
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
  const guildId = voiceChannel.guild.id;

  if (typeof engine.play === 'function') {
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

  const r = await resolve(query);
  const items = r.tracks.map(t => ({
    ...t,
    requesterTag: requester?.tag || null,
    requesterId: requester?.id || null,
    radioLabel: radioLabel || null,
  }));
  const { waitMs } = await engine.playItems(voiceChannel, items, { requester, textChannel, radioLabel });

  if (r.kind === 'bandcamp-album') {
    return {
      kind: 'bandcamp',
      album: { title: r.albumTitle, artist: r.albumArtist, count: items.length, tracks: items.map(t => t.title) },
      waitMs,
    };
  }
  if (r.kind === 'playlist') {
    return {
      kind: 'playlist', track: viewOf(items[0]),
      playlist: { title: r.title || 'playlist', author: '', url: '', count: items.length },
      waitMs,
    };
  }
  const v = engine.queueView(guildId);
  const upcoming = v ? v.size : items.length - 1;
  return {
    kind: 'track',
    track: viewOf(items[0]),
    position: upcoming === 0 ? '▶ сейчас' : upcoming,
    nextTitle: v && v.upcoming.length ? v.upcoming[0].title : (items[1]?.title || null),
    waitMs,
  };
}

module.exports = {
  engineName: () => 'lavalink',

  play,

  skip: (client, guildId) => {
    const e = eng(client);
    if (typeof e.skip === 'function') return e.skip(guildId);
    return false;
  },
  stop: async (client, guildId) => {
    const e = eng(client);
    if (typeof e.stop === 'function') { await e.stop(guildId); return true; }
    return false;
  },
  pause: (client, guildId, on) => {
    const e = eng(client);
    if (typeof e.hasQueue === 'function' && !e.hasQueue(guildId)) return false;
    if (typeof e.pause === 'function') return e.pause(guildId, on !== false);
    return false;
  },
  resume: (client, guildId) => {
    const e = eng(client);
    if (typeof e.pause === 'function') return e.pause(guildId, false);
    return false;
  },
  seek: (client, guildId, ms) => {
    const e = eng(client);
    if (typeof e.seek === 'function') return e.seek(guildId, ms);
    return false;
  },
  volume: (client, guildId, vol) => {
    const e = eng(client);
    if (typeof e.hasQueue === 'function' && !e.hasQueue(guildId)) return false;
    if (typeof e.volume === 'function') return e.volume(guildId, vol);
    return false;
  },
  loop: (client, guildId, mode) => {
    const e = eng(client);
    if (typeof e.hasQueue === 'function' && !e.hasQueue(guildId)) return false;
    const m = mode === 3 ? 0 : mode;
    if (typeof e.loop === 'function') return e.loop(guildId, m);
    return false;
  },
  shuffle: (client, guildId) => {
    const e = eng(client);
    if (typeof e.queueView === 'function') {
      const v = e.queueView(guildId);
      if (!v || v.size === 0) return false;
    }
    if (typeof e.shuffle === 'function') return e.shuffle(guildId);
    return false;
  },
  clear: (client, guildId) => {
    const e = eng(client);
    if (typeof e.hasQueue === 'function' && !e.hasQueue(guildId)) return false;
    if (typeof e.clear === 'function') return e.clear(guildId);
    return false;
  },
  remove: (client, guildId, idx) => {
    const e = eng(client);
    if (typeof e.remove === 'function') return e.remove(guildId, idx);
    if (typeof e.removeAt === 'function') {
      const t = e.removeAt(guildId, idx);
      return t ? { title: t.title } : null;
    }
    return null;
  },
  move: (client, guildId, from, to) => {
    const e = eng(client);
    if (typeof e.move === 'function') return e.move(guildId, from, to);
    return false;
  },
  prev: (client, guildId) => {
    const e = eng(client);
    if (typeof e.prev === 'function') return e.prev(guildId);
    if (typeof e.prevTrack === 'function') return e.prevTrack(guildId);
    return false;
  },

  queueView: (client, guildId) => {
    const e = eng(client);
    if (typeof e.queueViewFull === 'function') return e.queueViewFull(guildId);
    if (typeof e.queueView === 'function') return e.queueView(guildId);
    return null;
  },
  npSnapshot: (client, guildId) => {
    const e = eng(client);
    if (typeof e.npSnapshot === 'function') return e.npSnapshot(guildId);
    return null;
  },
  voiceChannelId: (client, guildId) => {
    const e = eng(client);
    if (typeof e.getPlayer === 'function') {
      const p = e.getPlayer(guildId);
      return p?.voiceChannelId || null;
    }
    if (typeof e.voiceChannelId === 'function') return e.voiceChannelId(guildId);
    return null;
  },
  formatDuration,
};
