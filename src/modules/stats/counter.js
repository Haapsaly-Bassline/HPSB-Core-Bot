// Member Count: голосовые/текстовые каналы-счётчики вида "👥 Участники: 123".
// Переименование не чаще раза в 15 мин (лимит Discord) и только при изменении цифры.
const { ChannelType } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');

let timer = null;
let running = false;
const lastNames = new Map(); // channelId -> name

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

async function setName(client, id, name) {
  if (!id || lastNames.get(id) === name) return;
  try {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch) return;
    if (ch.name === name) { lastNames.set(id, name); return; }
    await ch.setName(name);
    lastNames.set(id, name);
    logger.info(`[stats] ${id} -> ${name}`);
  } catch (e) { logger.warn('[stats] rename failed', id, e.message); }
}

async function update(client) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;
  const s = config.stats;
  if (!s.members && !s.humans && !s.bots && !s.boosts) return;

  let members = null;
  try {
    if (s.humans || s.bots) {
      await guild.members.fetch().catch(() => {});
      const all = guild.members.cache;
      const bots = all.filter(m => m.user.bot).size;
      members = { total: guild.memberCount, bots, humans: guild.memberCount - bots };
    } else {
      members = { total: guild.memberCount, bots: 0, humans: 0 };
    }
  } catch (e) { logger.warn('[stats]', e.message); return; }

  // префиксы можно менять в .env: STATS_MEMBERS_LABEL и т.д.
  if (s.members) await setName(client, s.members, `${s.membersLabel}: ${fmt(members.total)}`);
  if (s.humans) await setName(client, s.humans, `${s.humansLabel}: ${fmt(members.humans)}`);
  if (s.bots) await setName(client, s.bots, `${s.botsLabel}: ${fmt(members.bots)}`);
  if (s.boosts) {
    try {
      const g2 = await guild.fetch().catch(() => guild);
      await setName(client, s.boosts, `${s.boostsLabel}: ${g2.premiumSubscriptionCount || 0}`);
    } catch {}
  }
}

function startStats(client) {
  const mins = Math.max(10, config.stats.intervalMin || 15);
  const run = async () => {
    if (running) return;
    running = true;
    try { await update(client); } catch (e) { logger.warn('[stats]', e.message); }
    finally { running = false; }
  };
  run();
  if (timer) clearInterval(timer);
  timer = setInterval(() => run().catch(e => logger.warn('[stats]', e.message)), mins * 60 * 1000);
  timer.unref?.();
  logger.info(`[stats] every ${mins}m`);
}

async function snapshot(client) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return null;
  await guild.members.fetch().catch(() => {});
  const bots = guild.members.cache.filter(m => m.user.bot).size;
  const g2 = await guild.fetch().catch(() => guild);
  return {
    total: guild.memberCount, humans: guild.memberCount - bots, bots,
    boosts: g2.premiumSubscriptionCount || 0, tier: g2.premiumTier,
    channels: g2.channels.cache.size, roles: g2.roles.cache.size,
  };
}

module.exports = { startStats, snapshot, ChannelType };
