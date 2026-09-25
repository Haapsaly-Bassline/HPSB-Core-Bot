// Свой музыкальный движок: официальный @discordjs/voice + FFmpeg + Opus, без discord-player.
// Каждый трек знает прямой источник байтов (см. resolvers.js) — никакой магии.
const voip = require('@discordjs/voice');
const prism = require('prism-media');
const { logger } = require('../../utils/logger');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildResource(streamUrl, { seekMs = 0, volume = 100 } = {}) {
  // Флаги как у рабочего питон-бота: reconnect + genpts, сырой s16le в Opus
  const args = [
    '-analyzeduration', '0', '-loglevel', 'error',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-fflags', '+genpts',
  ];
  if (seekMs > 0) args.push('-ss', (seekMs / 1000).toFixed(3));
  args.push('-i', streamUrl, '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2');
  if (volume !== 100) args.push('-filter:a', `volume=${Math.min(Math.max(volume / 100, 0), 2).toFixed(2)}`);
  const ff = new prism.FFmpeg({ args });
  const opus = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
  ff.on('error', () => {});
  opus.on('error', () => {});
  return voip.createAudioResource(ff.pipe(opus), { inputType: voip.StreamType.Raw });
}

class GuildMusic {
  constructor(engine, guildId) {
    this.engine = engine;
    this.guildId = guildId;
    this.connection = null;
    this.player = null;
    this.queue = [];        // следующие
    this.current = null;    // { item, startedAt, offsetMs }
    this.prev = [];         // история (макс. 25)
    this.loop = 0;          // 0 off, 1 track, 2 queue
    this.volume = 100;
    this.textChannel = null;
    this.radioLabel = null;
    this.bound = false;
  }

  get voiceChannelId() { return this.connection?.joinConfig?.channelId || null; }
  get playing() { return !!this.current; }
  get paused() { return this.player?.state?.status === voip.AudioPlayerStatus.Paused; }

  async ensureConnection(voiceChannel) {
    if (this.connection) {
      try {
        const st = this.connection.state.status;
        if (st === voip.VoiceConnectionStatus.Destroyed) this.connection = null;
        else if (this.voiceChannelId !== voiceChannel.id) {
          try { this.connection.destroy(); } catch {}
          this.connection = null;
        }
      } catch { this.connection = null; }
    }
    if (!this.connection) {
      this.connection = voip.joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: this.guildId,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      this.connection.on('error', (e) => logger.warn('[engine] conn error', e.message));
      try {
        await voip.entersState(this.connection, voip.VoiceConnectionStatus.Ready, 15000);
      } catch {
        const st = this.connection?.state?.status || '?';
        try { this.connection.destroy(); } catch {}
        this.connection = null;
        throw new Error(`Не смог подключиться к войсу (статус: ${st}). Если висит на signalling — сеть режет голосовой UDP.`);
      }
      // Сцена: слушателя не слышно — пробуем стать спикером
      if (voiceChannel.type === 13) {
        try {
          const me = voiceChannel.guild.members.me
            || await voiceChannel.guild.members.fetch(this.engine.client.user.id).catch(() => null);
          await me?.voice?.setSuppressed(false).catch(() => {});
          if (me?.voice?.suppress) {
            this.textChannel?.send('⚠️ Я на сцене, но не спикер — дайте мне слово (Invite to Speak), иначе меня не слышно.').catch(() => {});
          }
        } catch {}
      }
    }
    if (!this.player) {
      this.player = voip.createAudioPlayer({ behaviors: { noSubscriber: voip.NoSubscriberBehavior.Play } });
      this.player.on('error', (e) => {
        logger.warn('[engine] player error', this.current?.item?.title || '', e.message);
        this.next().catch(() => {});
      });
      this.player.on(voip.AudioPlayerStatus.Idle, () => {
        // естественный конец трека (скип идёт через stop()+таймер, см. skip())
        if (this.current) this.next().catch(() => {});
      });
      this.connection.subscribe(this.player);
    }
    return this.connection;
  }

  async enqueueTracks(items, { requester, textChannel, radioLabel }) {
    const now = Date.now();
    for (const item of items) {
      this.queue.push({
        ...item,
        requesterTag: requester?.tag || null,
        requesterId: requester?.id || null,
        radioLabel: radioLabel || null,
        addedAt: now,
      });
    }
    this.textChannel = textChannel || this.textChannel;
    if (radioLabel) this.radioLabel = radioLabel;
    if (!this.current) await this.next();
  }

  async resolveStreamUrl(item) {
    const s = item.stream;
    if (!s) throw new Error('Нет источника аудио');
    if (s.type === 'direct' || s.type === 'preview') return s.url;
    if (s.type === 'soundcloud') {
      const sc = require('./soundcloud');
      return sc.resolveStream({ streamUrl: s.api, hls: s.hls });
    }
    throw new Error(`Неизвестный тип стрима: ${s.type}`);
  }

  async playCurrent(offsetMs = 0) {
    const cur = this.current;
    if (!cur) return;
    const url = await this.resolveStreamUrl(cur.item);
    const resource = buildResource(url, { seekMs: offsetMs, volume: this.volume });
    cur.startedAt = Date.now();
    cur.offsetMs = offsetMs;
    this.player.play(resource);
    this.engine.emitTrackStart(this.guildId);
  }

  async next(autoplay = false) {
    if (this.current) {
      this.prev.push(this.current.item);
      if (this.prev.length > 25) this.prev.shift();
    }
    const skipRepeat = this._noRepeatOnce;
    this._noRepeatOnce = false;
    if (!autoplay && this.loop === 1 && this.current && !skipRepeat) {
      // повтор трека: играем заново (история не дублируется)
      this.prev.pop();
      await this.playCurrent(0).catch((e) => this.failCurrent(e));
      return;
    }
    if (this.loop === 2 && this.current && !autoplay) {
      this.queue.push(this.current.item);
    }
    const next = this.queue.shift() || null;
    this.current = next ? { item: next, startedAt: 0, offsetMs: 0 } : null;
    if (!this.current) {
      this.engine.emitQueueEnd(this.guildId);
      return;
    }
    await this.playCurrent(0).catch((e) => this.failCurrent(e));
  }

  async failCurrent(e) {
    logger.warn('[engine] stream failed', this.current?.item?.title || '', String(e.message || e).slice(0, 200));
    const ch = this.textChannel;
    this.current = null;
    if (ch?.isTextBased?.()) {
      ch.send(`⚠️ Трек не заиграл (${String(e.message || e).slice(0, 150)}), иду дальше…`).catch(() => {});
    }
    await this.next();
  }

  positionMs() {
    if (!this.current) return 0;
    try {
      const d = this.player?.state?.playbackDuration || 0;
      return (this.current.offsetMs || 0) + d;
    } catch { return this.current.offsetMs || 0; }
  }

  async skip() {
    if (!this.current) return false;
    this.player?.stop(); // дальше сработает Idle -> next()
    return true;
  }

  async stop() {
    try { this.player?.stop(true); } catch {}
    this.queue = [];
    this.current = null;
    try { this.connection?.destroy(); } catch {}
    this.connection = null;
    this.player = null;
    this.engine.emitQueueEnd(this.guildId, 'Остановлено');
  }

  pause(on = true) {
    if (!this.player) return false;
    try { on !== false ? this.player.pause() : this.player.unpause(); return true; } catch { return false; }
  }

  async seek(ms) {
    if (!this.current || this.current.item.isLive) return false;
    await this.playCurrent(ms).catch(() => {});
    return true;
  }

  async setVolume(vol) {
    this.volume = Math.min(Math.max(vol, 0), 200);
    if (this.current) await this.playCurrent(this.positionMs()).catch(() => {});
    return true;
  }

  setLoop(mode) { this.loop = [0, 1, 2].includes(mode) ? mode : 0; return true; }
  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    return true;
  }
  clear() { this.queue = []; return true; }

  removeAt(idx) {
    if (idx < 0 || idx >= this.queue.length) return null;
    const [t] = this.queue.splice(idx, 1);
    return t || null;
  }

  move(from, to) {
    if (from < 0 || from >= this.queue.length || to < 0 || to >= this.queue.length) return false;
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    return true;
  }

  async prevTrack() {
    const t = this.prev.pop();
    if (!t) return false;
    this.queue.unshift(t);
    this._noRepeatOnce = true; // чтобы loop-track не переиграл текущий вместо возврата
    this.player?.stop(); // Idle -> next() подхватит возвращённый трек
    return true;
  }

  // --- Вью для команд/NP (формы как раньше, команды не меняются) ---
  viewOf(item) {
    if (!item) return null;
    const ms = item.durationMs || 0;
    return {
      title: item.title || 'Unknown', url: item.url || '', author: item.author || '',
      thumbnail: item.thumbnail || '', durationMs: ms,
      durationLabel: ms > 0 ? fmtDur(ms) : 'LIVE',
      requesterTag: item.requesterTag || null, isLive: !!item.isLive,
    };
  }

  queueView() {
    if (!this.current && !this.queue.length) return null;
    const upcoming = this.queue.slice(0, 15).map((t, i) => ({ n: i + 1, ...this.viewOf(t) }));
    const totalMs = (this.current?.item?.durationMs || 0) + this.queue.reduce((a, t) => a + (t.durationMs || 0), 0);
    return {
      current: this.viewOf(this.current?.item), upcoming,
      size: this.queue.length, totalMs,
      repeatMode: this.loop, paused: this.paused,
    };
  }

  npSnapshot() {
    if (!this.current) return null;
    const track = this.viewOf(this.current.item);
    if (this.current.item.radioLabel) track.title = `📻 ${this.current.item.radioLabel}`;
    track.requesterTag = this.current.item.requesterTag || null;
    return {
      track, positionMs: this.positionMs(),
      durationMs: this.current.item.durationMs || 0,
      repeatMode: this.loop, paused: this.paused,
      size: this.queue.length, radioLabel: this.current.item.radioLabel || null,
    };
  }
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

class MusicEngine {
  constructor(client, { onTrackStart, onQueueEnd } = {}) {
    this.client = client;
    this.guilds = new Map();
    this.onTrackStart = onTrackStart || (() => {});
    this.onQueueEnd = onQueueEnd || (() => {});
  }

  of(guildId) {
    let g = this.guilds.get(guildId);
    if (!g) { g = new GuildMusic(this, guildId); this.guilds.set(guildId, g); }
    return g;
  }

  emitTrackStart(guildId) { try { this.onTrackStart(guildId); } catch {} }
  emitQueueEnd(guildId, note) { try { this.onQueueEnd(guildId, note); } catch {} }

  // Низкоуровневый play уже резолвленных айтемов
  async playItems(voiceChannel, items, { requester, textChannel, radioLabel } = {}) {
    const g = this.of(voiceChannel.guild.id);
    await g.ensureConnection(voiceChannel);
    // ETA до добавления (как раньше)
    const waitMs = g.current
      ? Math.max((g.current.item.durationMs || 0) - g.positionMs(), 0)
        + g.queue.reduce((a, t) => a + (t.durationMs || 0), 0)
      : 0;
    await g.enqueueTracks(items, { requester, textChannel, radioLabel });
    return { waitMs };
  }

  skip(g) { return this.of(g).skip(); }
  async stop(g) { await this.of(g).stop(); }
  pause(g, on) { return this.of(g).pause(on); }
  seek(g, ms) { return this.of(g).seek(ms); }
  setVolume(g, v) { return this.of(g).setVolume(v); }
  setLoop(g, m) { return this.of(g).setLoop(m); }
  shuffle(g) { const x = this.of(g); if (!x.playing && !x.queue.length) return false; if (!x.queue.length) return false; x.shuffle(); return true; }
  clear(g) { this.of(g).clear(); return true; }
  removeAt(g, i) { return this.of(g).removeAt(i); }
  move(g, a, b) { return this.of(g).move(a, b); }
  prevTrack(g) { return this.of(g).prevTrack(); }
  queueView(g) { return this.of(g).queueView(); }
  npSnapshot(g) { return this.of(g).npSnapshot(); }
  voiceChannelId(g) { return this.of(g).voiceChannelId; }
  hasQueue(g) { const x = this.guilds.get(g); return !!(x && (x.current || x.queue.length)); }
}

module.exports = { MusicEngine };
