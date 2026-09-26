// Member Count parity: 9 счётчиков с шаблонами {count}, on/off, setup.
// Переименование только при изменении (лимит Discord), интервал ≥10 мин.
const { ChannelType } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const store = require('../../utils/store');

const TYPES = ['members', 'humans', 'bots', 'roles', 'channels', 'role', 'online', 'offline', 'boosts'];

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function templateFor(key) {
  const data = store.load();
  return data.statsTemplates?.[key] || config.stats.t[key] || `{count}`;
}

function channelIdsFor(key) {
  // Один тип -> НЕСКОЛЬКО каналов: env (один) + store (один или массив)
  const data = store.load();
  const out = [];
  if (config.stats[key]) out.push(config.stats[key]);
  const s = data.statsChannels?.[key];
  if (Array.isArray(s)) out.push(...s);
  else if (s) out.push(s);
  return [...new Set(out.filter(Boolean))];
}

// Совместимость со старым кодом (первый канал)
function channelIdFor(key) {
  return channelIdsFor(key)[0] || '';
}

function isEnabled(key) {
  const data = store.load();
  return !(data.statsDisabled || []).includes(key);
}

function renderName(key, value) {
  const t = templateFor(key);
  const v = fmt(value);
  return t.includes('{count}') ? t.split('{count}').join(v).slice(0, 100) : `${t} ${v}`.slice(0, 100);
}

let timer = null;
let running = false;
const lastNames = new Map(); // channelId -> name
let presenceWarned = false;

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

async function collect(guild) {
  // полный список участников нужен только части счётчиков
  const needMembers = ['humans', 'bots', 'role', 'online', 'offline'].some(k => channelIdsFor(k).length && isEnabled(k));
  let members = null;
  if (needMembers) {
    try { await guild.members.fetch(); } catch {}
    members = guild.members.cache;
  }
  const g2 = await guild.fetch().catch(() => guild);
  const bots = members ? members.filter(m => m.user.bot).size : 0;
  const total = guild.memberCount;
  let online = 0, offline = 0, presenceSeen = false;
  if (members) {
    for (const m of members.values()) {
      const st = m.presence?.status;
      if (!st) continue;
      presenceSeen = true;
      if (st === 'offline') offline++;
      else online++;
    }
  }
  const roleId = store.load().statsRoleId || config.stats.roleId;
  const roleCount = members && roleId ? members.filter(m => m.roles.cache.has(roleId)).size : 0;

  return {
    members: total,
    humans: members ? total - bots : 0,
    bots: members ? bots : 0,
    roles: guild.roles.cache.size,
    channels: guild.channels.cache.size,
    role: roleCount,
    online, offline, presenceSeen,
    boosts: g2.premiumSubscriptionCount || 0,
    tier: g2.premiumTier,
  };
}

async function update(client) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;
  const vals = await collect(guild);
  if (!vals.presenceSeen && (channelIdsFor('online').length || channelIdsFor('offline').length)) {
    if (!presenceWarned) {
      presenceWarned = true;
      logger.warn('[stats] online/offline: нет presences — включи Presence Intent в Portal');
    }
  }
  const jobs = [
    ['members', vals.members],
    ['humans', vals.humans],
    ['bots', vals.bots],
    ['roles', vals.roles],
    ['channels', vals.channels],
    ['boosts', vals.boosts],
  ];
  if (vals.presenceSeen) jobs.push(['online', vals.online], ['offline', vals.offline]);
  if (store.load().statsRoleId || config.stats.roleId) jobs.push(['role', vals.role]);
  for (const [key, value] of jobs) {
    if (!isEnabled(key)) continue;
    for (const id of channelIdsFor(key)) {
      await setName(client, id, renderName(key, value));
    }
  }
}

function startStats(client) {
  const mins = Math.max(10, config.stats.intervalMin || 10);
  const active = TYPES.filter(k => channelIdFor(k) && isEnabled(k));
  if (!active.length) {
    logger.warn('[stats] НЕТ настроенных счётчиков — запусти /counters setup (или впиши STATS_*_CHANNEL_ID)');
  } else {
    logger.info('[stats] active:', active.map(k => `${k}->${channelIdFor(k)}`).join(', '));
  }
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
  const vals = await collect(guild);
  return {
    total: vals.members, humans: vals.humans, bots: vals.bots,
    roles: vals.roles, channels: vals.channels, role: vals.role,
    online: vals.online, offline: vals.offline, presenceSeen: vals.presenceSeen,
    boosts: vals.boosts, tier: vals.tier,
  };
}

module.exports = { startStats, snapshot, TYPES, channelIdFor, channelIdsFor, templateFor, isEnabled, renderName, ChannelType };
