const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { config, validate } = require('./config');
const { logger } = require('./utils/logger');
const fs = require('node:fs');
const path = require('node:path');

// FFmpeg: берём бинарник из ffmpeg-static, чтобы войс точно его находил
try {
  if (!process.env.FFMPEG_PATH) {
    const bin = require('ffmpeg-static');
    if (bin) process.env.FFMPEG_PATH = bin;
  }
} catch {}

validate();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

// --- Music player (discord-player v6, own implementation, not Jockie copy) ---
const player = new Player(client, {
  skipFFmpeg: false,
});
client.player = player;

(async () => {
  try {
    // Регистрируем по одному: YouTube идёт через YoutubeiExtractor (InnerTube API,
    // стабильнее скрапинга), остальные — из @discord-player/extractor.
    // Bandcamp/Audiomack прямых экстракторов нет — работают через прямые audio-ссылки.
    const dp = require('@discord-player/extractor');
    for (const Ext of [dp.AttachmentExtractor, dp.SoundCloudExtractor, dp.AppleMusicExtractor, dp.VimeoExtractor, dp.ReverbnationExtractor]) {
      await player.extractors.register(Ext, {});
    }
    // Spotify: ключи идут именно сюда (DP_SPOTIFY_*), без них — только текстовый поиск
    if (!process.env.DP_SPOTIFY_CLIENT_ID && config.music.spotifyClientId) {
      process.env.DP_SPOTIFY_CLIENT_ID = config.music.spotifyClientId;
      process.env.DP_SPOTIFY_CLIENT_SECRET = config.music.spotifyClientSecret || '';
    }
    await player.extractors.register(dp.SpotifyExtractor, {
      clientId: config.music.spotifyClientId || undefined,
      clientSecret: config.music.spotifyClientSecret || undefined,
    });
    try {
      const { YoutubeExtractor: YoutubeiExtractor } = require('discord-player-youtubei');
      await player.extractors.register(YoutubeiExtractor, {});
      logger.info('[music] extractors loaded (youtubei + spotify/soundcloud/apple/vimeo/attachment)');
    } catch (e2) {
      logger.warn('[music] youtubei failed, fallback to default youtube:', e2.message);
      await player.extractors.register(dp.YoutubeExtractor, {});
      logger.info('[music] extractors loaded (default youtube + others)');
    }
  } catch (e) {
    logger.error('[music] extractor load failed', e.message);
  }
})();

player.events.on('playerStart', async (queue, track) => {
  try {
    // Сцена (Stage): слушателя не слышно — пробуем стать спикером
    if (queue.channel?.type === 13) {
      try {
        const me = queue.guild?.members?.me || await queue.guild?.members?.fetch(client.user.id).catch(() => null);
        await me?.voice?.setSuppressed(false).catch(() => {});
        if (me?.voice?.suppress) {
          queue.metadata?.channel?.send('⚠️ Я на сцене, но не спикер — дайте мне слово (Invite to Speak), иначе меня не слышно.').catch(() => {});
        }
      } catch {}
    }
    require('./modules/music/np').trackStart(client, queue, track);
  } catch {}
});
// Живой NP: финализация и мгновенное обновление кнопок
player.events.on('emptyQueue', (queue) => {
  try { require('./modules/music/np').finalize(client, queue.guild.id, 'Очередь завершена'); } catch {}
});
player.events.on('queueDelete', (queue) => {
  try { require('./modules/music/np').finalize(client, queue.guild.id, 'Остановлено'); } catch {}
});
player.events.on('playerPause', (queue) => {
  try { require('./modules/music/np').render(client, queue.guild.id); } catch {}
});
player.events.on('playerResume', (queue) => {
  try { require('./modules/music/np').render(client, queue.guild.id); } catch {}
});
player.events.on('error', (queue, err) => {
  const msg = String(err?.message || err || '');
  // AbortError — обычно просто скип/стоп, не ошибка. Шум не нужен.
  if (/abort/i.test(msg)) {
    logger.warn('[music] queue aborted', queue?.currentTrack?.title || '');
    return;
  }
  logger.error('[music] queue error', queue?.currentTrack?.title || '', '-', msg);
});

// Lavalink-движок: только при MUSIC_ENGINE=lavalink (host PC / VPS).
// По умолчанию инертен — discord-player путь не трогаем.
if (config.music.engine === 'lavalink') {
  (async () => {
    try {
      const { LavalinkEngine } = require('./modules/music/engine-lavalink');
      client.lavalink = await new LavalinkEngine(client, config.music).init();
    } catch (e) { logger.error('[lavalink] init failed', e.message); }
  })();
}

// --- Load commands ---
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(commandsPath, file));
    if (cmd?.data?.name) client.commands.set(cmd.data.name, cmd);
  }
  logger.info(`[core] loaded ${client.commands.size} commands`);
}

// --- Load events ---
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
    const ev = require(path.join(eventsPath, file));
    if (ev.once) client.once(ev.name, (...a) => ev.execute(...a, client));
    else client.on(ev.name, (...a) => ev.execute(...a, client));
  }
}

// --- Modules (pollers / webhook / honeypot use events, started on ready) ---
client.modules = {};
// reposter + site publisher + webhook стартуют в events/ready.js чтобы client уже был залогинен

process.on('unhandledRejection', (e) => logger.error('[unhandled]', e?.stack || e));

client.login(config.token).catch((e) => {
  logger.error('Login failed. Check DISCORD_TOKEN in .env');
  logger.error(e.message);
  process.exit(1);
});
