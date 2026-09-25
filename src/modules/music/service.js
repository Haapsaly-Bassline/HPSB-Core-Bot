// MusicService — единая точка входа музыки. Свой движок (engine.js) + свои резолверы.
// Формы ответов как раньше — команды и NP не менялись.
const { resolve } = require('./resolvers');
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

async function play(client, voiceChannel, query, { requester, textChannel, radioLabel } = {}) {
  const r = await resolve(query);
  const guildId = voiceChannel.guild.id;
  const items = r.tracks.map(t => ({
    ...t,
    requesterTag: requester?.tag || null,
    requesterId: requester?.id || null,
    radioLabel: radioLabel || null,
  }));
  const { waitMs } = await eng(client).playItems(voiceChannel, items, { requester, textChannel, radioLabel });

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
  const v = eng(client).queueView(guildId);
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
  engineName: () => 'hpsb-engine',

  play,
  skip: (client, guildId) => eng(client).skip(guildId),
  stop: async (client, guildId) => { await eng(client).stop(guildId); return true; },
  pause: (client, guildId, on) => {
    if (!eng(client).hasQueue(guildId)) return false;
    return eng(client).pause(guildId, on !== false);
  },
  seek: (client, guildId, ms) => eng(client).seek(guildId, ms),
  volume: (client, guildId, vol) => {
    if (!eng(client).hasQueue(guildId)) return false;
    return eng(client).setVolume(guildId, vol);
  },
  loop: (client, guildId, mode) => {
    if (!eng(client).hasQueue(guildId)) return false;
    const m = mode === 3 ? 0 : mode; // autoplay у своего движка нет — маппим в off
    return eng(client).setLoop(guildId, m);
  },
  shuffle: (client, guildId) => {
    const v = eng(client).queueView(guildId);
    if (!v || v.size === 0) return false;
    return eng(client).shuffle(guildId);
  },
  clear: (client, guildId) => {
    if (!eng(client).hasQueue(guildId)) return false;
    return eng(client).clear(guildId);
  },
  remove: (client, guildId, idx) => {
    const t = eng(client).removeAt(guildId, idx);
    return t ? { title: t.title } : null;
  },
  move: (client, guildId, from, to) => eng(client).move(guildId, from, to),
  prev: (client, guildId) => eng(client).prevTrack(guildId),

  queueView: (client, guildId) => eng(client).queueView(guildId),
  npSnapshot: (client, guildId) => eng(client).npSnapshot(guildId),
  voiceChannelId: (client, guildId) => eng(client).voiceChannelId(guildId),
};
