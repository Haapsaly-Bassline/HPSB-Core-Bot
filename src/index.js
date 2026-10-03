const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { config, validate } = require('./config');

// IPv6-выход у многих провайдеров висит (таймаут вместо отказа), а Node берёт
// первую запись DNS. Форсим IPv4 первым: браузеры так и делают (Happy Eyeballs).
try { require('node:dns').setDefaultResultOrder('ipv4first'); } catch {}
const { logger } = require('./utils/logger');
const fs = require('node:fs');
const path = require('node:path');

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
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

function initLegacyEngine() {
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
  logger.info('[music] legacy hpsb-engine active');
}

function initLavalinkEngine() {
  const { LavalinkEngine } = require('./modules/music/engine-lavalink');
  client.music = new LavalinkEngine(client, { lavalink: config.music.lavalink });
  client.music.init().then(() => {
    logger.info('[music] lavalink-engine ready');
  }).catch((err) => {
    logger.error('[music] lavalink init failed:', err?.message || err);
    logger.warn('[music] falling back to legacy hpsb engine');
    initLegacyEngine();
  });
}

if (config.music.engine === 'lavalink') {
  initLavalinkEngine();
} else {
  initLegacyEngine();
}

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

logger.info('[music] engine bootstrap complete');

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(commandsPath, file));
    if (cmd?.data?.name) client.commands.set(cmd.data.name, cmd);
  }
  logger.info(`[core] loaded ${client.commands.size} commands`);
}

const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
    const ev = require(path.join(eventsPath, file));
    if (ev.once) client.once(ev.name, (...a) => ev.execute(...a, client));
    else client.on(ev.name, (...a) => ev.execute(...a, client));
  }
}

client.modules = {};
process.on('unhandledRejection', (e) => logger.error('[unhandled]', e?.stack || e));

client.login(config.token).catch((e) => {
  logger.error('Login failed. Check DISCORD_TOKEN in .env');
  logger.error(e.message);
  process.exit(1);
});
