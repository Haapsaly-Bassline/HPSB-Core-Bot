// MusicService — единая точка входа музыки.
// Команды НЕ знают, какой движок снизу: discord-player или lavalink.
// Выбор — флагом MUSIC_ENGINE. Интерфейс возвращает plain-data, эмбеды строят команды.
const { config } = require('../../config');

function useLavalink(client) {
  return config.music.engine === 'lavalink' && !!client.lavalink;
}

function backend(client) {
  if (useLavalink(client)) return require('./engine-lavalink-adapter');
  return require('./backend-dp');
}

module.exports = {
  engineName: (client) => (useLavalink(client) ? 'lavalink' : 'discord-player'),

  play: (client, voiceChannel, query, opts) => backend(client).play(client, voiceChannel, query, opts),
  skip: (client, guildId) => backend(client).skip(client, guildId),
  stop: (client, guildId) => backend(client).stop(client, guildId),
  pause: (client, guildId, on) => backend(client).pause(client, guildId, on),
  seek: (client, guildId, ms) => backend(client).seek(client, guildId, ms),
  volume: (client, guildId, vol) => backend(client).volume(client, guildId, vol),
  loop: (client, guildId, mode) => backend(client).loop(client, guildId, mode),
  shuffle: (client, guildId) => backend(client).shuffle(client, guildId),
  clear: (client, guildId) => backend(client).clear(client, guildId),
  remove: (client, guildId, idx) => backend(client).remove(client, guildId, idx),
  move: (client, guildId, from, to) => backend(client).move(client, guildId, from, to),
  prev: (client, guildId) => backend(client).prev(client, guildId),

  // queueView: { current, upcoming[{n,title,url,author,durationLabel}], size, totalMs, repeatMode, paused } | null
  queueView: (client, guildId) => backend(client).queueView(client, guildId),
  // npSnapshot: { track, positionMs, repeatMode, paused, size, radioLabel } | null
  npSnapshot: (client, guildId) => backend(client).npSnapshot(client, guildId),
  // voiceChannelId бота в гильдии (для проверки кнопок)
  voiceChannelId: (client, guildId) => backend(client).voiceChannelId(client, guildId),
};
