// Lavalink-движок музыки (включается на host PC: MUSIC_ENGINE=lavalink).
// Зеркалит поведение discord-player-пути: те же эмбеды Now Playing / Added Track.
// Живое тестирование звука — только на host PC (там рабочий UDP).

const { LavalinkManager } = require('lavalink-client');
const { logger } = require('../../utils/logger');

const LOOP_MAP = { 0: 'off', 1: 'track', 2: 'queue' };
const LOOP_BACK = { off: 0, track: 1, queue: 2 };

// источник поиска Lavalink по нашему движку
function searchSource(engine, query) {
  if (/^https?:\/\//i.test(query || '')) return query; // URL резолвит нода сама
  switch (engine) {
    case 'soundcloud': return `scsearch:${query}`;
    case 'spotify': return `spsearch:${query}`;
    default: return `ytsearch:${query}`;
  }
}

class LavalinkEngine {
  constructor(client, musicCfg) {
    this.client = client;
    this.cfg = musicCfg;
    this.manager = null;
  }

  async init() {
    const { host, port, password, secure } = this.cfg.lavalink;
    this.manager = new LavalinkManager({
      nodes: [{ host, port, authorization: password, secure, id: 'hpsb-main', regions: ['europe'] }],
      sendToShard: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        if (guild?.shard) guild.shard.send(payload);
      },
      client: { id: this.client.user.id, username: this.client.user.tag },
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

    await this.manager.init(this.client.user);
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

  // query: URL или текст; engine: 'youtube'|'soundcloud'|'spotify'|'arbitrary'
  // arbitrary (прямые mp3/радио) отдаём ноде как есть.
  async play(voiceChannel, query, { requester, metadata = {}, engine = 'youtube' } = {}) {
    const player = await this.ensurePlayer(voiceChannel, metadata.channel?.id);
    const q = engine === 'arbitrary' ? query : searchSource(engine, query);
    const res = await player.search({ query: q }, requester).catch(() => null);
    if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
      throw new Error(`No results for "${String(query).slice(0, 120)}"`);
    }
    player.setData({ requesterId: requester?.id || null, radioLabel: metadata.radioLabel || null });

    if (res.loadType === 'playlist') {
      await player.queue.add(res.tracks);
      if (!player.playing && !player.paused) await player.play().catch(() => {});
      return { track: res.tracks[0], queue: player.queue, playlist: { title: res.playlist?.name || res.playlist?.title, count: res.tracks.length } };
    }
    const track = res.tracks[0];
    await player.queue.add(track);
    if (!player.playing && !player.paused) await player.play().catch(() => {});
    return { track, queue: player.queue, playlist: null };
  }

  async onTrackStart(player, track) {
    try {
      const { nowPlayingEmbed } = require('../../utils/embeds');
      const info = track?.info || {};
      const data = player.getData?.() || {};
      let requester = null;
      try { if (data.requesterId) requester = await this.client.users.fetch(data.requesterId).catch(() => null); } catch {}
      const shown = {
        title: data.radioLabel ? `📻 ${data.radioLabel}` : (info.title || 'Unknown'),
        url: info.uri || '',
        author: info.author || '',
        thumbnail: info.artworkUrl || '',
        duration: info.isStream ? 'LIVE' : fmtDur(info.length),
      };
      const ch = player.textChannelId ? await this.client.channels.fetch(player.textChannelId).catch(() => null) : null;
      // прогресс-бар живого трека Lavalink не даёт на старте — nowPlayingEmbed сам покажет 0:00
      if (ch?.isTextBased()) await ch.send({ embeds: [nowPlayingEmbed(shown, null, requester)] }).catch(() => {});
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
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function infoOf(t) {
  const info = t?.info || t || {};
  return { title: info.title || 'Unknown', author: info.author || '', url: info.uri || info.url || '', duration: info.isStream ? 'LIVE' : fmtDur(info.length) };
}

module.exports = { LavalinkEngine };
