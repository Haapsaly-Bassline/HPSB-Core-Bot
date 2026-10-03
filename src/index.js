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

// Бот работает ИСКЛЮЧИТЕЛЬНО на Lavalink (legacy hpsb engine удалён).
// client.music поднимается в ready.js (нужен client.user.id); до ready музыки нет —
// команды честно ответят "Music engine не инициализирован".
client.music = null;
client.lavalink = null;
logger.info('[music] lavalink-only mode (init deferred until ready)');

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
