const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { config, validate } = require('./config');

// IPv6-выход у многих провайдеров висит (таймаут вместо отказа), а Node берёт
// первую запись DNS. Форсим IPv4 первым: браузеры так и делают (Happy Eyeballs).
try { require('node:dns').setDefaultResultOrder('ipv4first'); } catch {}
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
    GatewayIntentBits.GuildPresences, // для online/offline счётчиков (включи в Portal)
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

// --- Свой музыкальный движок (без discord-player): voice + FFmpeg + свои резолверы ---
const { MusicEngine } = require('./modules/music/engine');
const np = require('./modules/music/np');
client.music = new MusicEngine(client, {
  onTrackStart: (guildId) => {
    try {
      const g = client.music.of(guildId);
      np.trackStart(client, guildId, g.textChannel);
    } catch {}
  },
  onQueueEnd: (guildId, note) => {
    try { np.finalize(client, guildId, note || 'Очередь завершена'); } catch {}
  },
});

// Voice self-test: сразу видно, есть ли чем играть (критично для host PC)
try {
  require('@discordjs/opus');
  logger.info('[voice] opus ok');
} catch {
  logger.error('[voice] NO OPUS — звука не будет! npm install-scripts approve @discordjs/opus + npm rebuild');
}
try {
  const bin = require('ffmpeg-static');
  const ok = bin && require('node:fs').existsSync(bin);
  if (ok) logger.info('[voice] ffmpeg ok');
  else logger.error('[voice] NO FFMPEG binary — звука не будет! npm rebuild ffmpeg-static');
} catch {
  logger.error('[voice] NO FFMPEG — звука не будет! npm install ffmpeg-static');
}

logger.info('[music] hpsb-engine ready');
// Ошибки движка логгирует сам engine.js (player/warn). Дамп деталей — в /logs.

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
