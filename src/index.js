const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { config, validate } = require('./config');

// Many ISPs have broken IPv6 (timeout instead of refusal), and Node picks
// the first DNS record. Force IPv4 first: browsers do the same (Happy Eyeballs).
try { require('node:dns').setDefaultResultOrder('ipv4first'); } catch {}
const { logger } = require('./utils/logger');
const fs = require('node:fs');
const path = require('node:path');

validate();

// Music-only: no privileged intents required.
// GuildVoiceStates is enough to join/leave voice channels; Lavalink plays the audio.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

// client.music is initialized in ready.js (needs client.user.id).
client.music = null;
client.lavalink = null;
logger.info('[music] lavalink-only mode (init deferred until ready)');

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

process.on('unhandledRejection', (e) => logger.error('[unhandled]', e?.stack || e));
process.on('uncaughtException', (e) => logger.error('[uncaught]', e?.stack || e));

client.login(config.token).catch((e) => {
  const msg = e?.message || String(e);
  // Don't blame the token for a dead route: connect/DNS timeouts mean the
  // machine can't reach discord.com:443 at all (ISP/VPN/firewall).
  if (/connect timeout|UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(msg)) {
    logger.error('Network unreachable: cannot reach discord.com:443. Check internet/VPN/firewall/IPv6 -- token was not even tried.');
  } else {
    logger.error('Login failed. Check DISCORD_TOKEN in .env');
  }
  logger.error(msg);
  process.exit(1);
});
