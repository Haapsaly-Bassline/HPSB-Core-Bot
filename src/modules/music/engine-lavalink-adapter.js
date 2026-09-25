// Lavalink-адаптер под интерфейс MusicService (те же сигнатуры, что backend-dp).
// Track-источники резолвит сама нода (yt/sc/sp/bc/http) — наши костыли не нужны.
function eng(client) {
  return client.lavalink;
}

function voiceOf(client, guildId) {
  return client.guilds.cache.get(guildId) || null;
}

async function play(client, voiceChannel, query, { requester, textChannel, engine, radioLabel } = {}) {
  const e = eng(client);
  // engine: 'youtube'|'soundcloud'|'spotify'|'arbitrary' -> нода резолвит URL сама
  const res = await e.play(voiceChannel, query, {
    requester,
    metadata: { channel: textChannel, requester, radioLabel: radioLabel || null },
    engine: engine === 'arbitrary' ? 'arbitrary' : (engine || 'youtube'),
  });
  if (res.playlist) {
    return {
      kind: 'playlist', track: res.track,
      playlist: { title: res.playlist.title, author: '', url: '', count: res.playlist.count },
      waitMs: 0,
    };
  }
  const q = e.getPlayer(voiceChannel.guild.id)?.queue;
  const upcoming = q ? q.tracks.length : 0;
  return {
    kind: 'track', track: res.track,
    position: upcoming === 0 ? '▶ сейчас' : upcoming,
    nextTitle: upcoming > 0 ? q.tracks[0]?.info?.title : null,
    waitMs: 0,
  };
}

module.exports = {
  play,
  skip: (client, guildId) => eng(client).skip(guildId),
  stop: (client, guildId) => eng(client).stop(guildId),
  pause: (client, guildId, on) => eng(client).pause(guildId, on !== false),
  seek: (client, guildId, ms) => eng(client).seek(guildId, ms).then(() => true).catch(() => false),
  volume: (client, guildId, vol) => eng(client).volume(guildId, vol).then(() => true).catch(() => false),
  loop: (client, guildId, mode) => eng(client).loop(guildId, mode).then(() => true).catch(() => false),
  shuffle: (client, guildId) => eng(client).shuffle(guildId),
  clear: (client, guildId) => eng(client).clear(guildId),
  remove: async (client, guildId, idx) => {
    const e = eng(client);
    const p = e.getPlayer(guildId);
    const t = p?.queue?.tracks?.[idx];
    if (!t) return null;
    const r = await e.remove(guildId, idx);
    return r ? { title: r.info?.title || 'Unknown' } : null;
  },
  move: (client, guildId, from, to) => eng(client).move(guildId, from, to),
  prev: (client, guildId) => eng(client).prev(guildId),
  queueView: (client, guildId) => eng(client).queueViewFull(guildId),
  npSnapshot: (client, guildId) => eng(client).npSnapshot(guildId),
  voiceChannelId: (client, guildId) => eng(client).getPlayer(guildId)?.voiceChannelId || null,
  voiceOf,
};
