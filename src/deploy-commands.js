require('dotenv').config();
// Same broken-IPv6 story as src/index.js: undici may stall on discord.com
// unless IPv4 is preferred (verified: default-family TCP 443 TIMEOUT, ipv4 OK).
try { require('node:dns').setDefaultResultOrder('ipv4first'); } catch {}
const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// Usage:
//   node src/deploy-commands.js      -- wipe own globals, publish guild set
//   node src/deploy-commands.js wipe -- wipe own globals + guild set (clean slate)
// Stale commands of a DELETED app cannot be removed via API at all -- they are
// client cache ghosts (Ctrl+R / relogin, up to ~24h). A live foreign app can
// only be cleaned with its own token from the Developer Portal.
const mode = process.argv[2] || 'deploy';

const commands = [];
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(dir, file));
  if (cmd?.data) commands.push(cmd.data.toJSON());
}

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID in .env -- cannot deploy.');
  process.exit(1);
}

(async () => {
  // Validate BEFORE touching anything: an unknown arg must never wipe first.
  if (mode !== 'deploy' && mode !== 'wipe') {
    console.error(`Unknown mode "${mode}" -- use: deploy (default) | wipe`);
    process.exit(1);
  }
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  if (mode === 'wipe') {
    const globals = await rest.get(Routes.applicationCommands(CLIENT_ID));
    const guild = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
    console.log(`[current] global commands found: ${globals.length}`);
    console.log(`[current] guild commands found: ${guild.length}`);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log('[current] global and guild commands wiped -- re-run without args to publish guild commands');
    return;
  }

  // A normal deploy only replaces this guild's commands. Never delete global
  // commands as a side effect; they may be used by another environment.
  const body = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands },
  );
  console.log(`Registered ${body.length} guild commands: ${body.map((c) => c.name).sort().join(', ')}`);
})().catch((e) => { console.error('Deploy failed:', e.message || e); process.exit(1); });
