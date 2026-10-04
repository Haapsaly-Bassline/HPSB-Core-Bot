// Honeypot + basic automod against "compromised accounts", scam links and nukes.
// Public trap: first message in channel = punishment (default mute 12h).
// Plus scam filter (nitro/gift/airdrop) and anti mass-ping.
const { PermissionFlagsBits } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');

const SCAM_PATTERNS = [
  /free[\s-_]?nitro/i,
  /discord[\s-_]?gift/i,
  /discord\.gift\//i,
  /steamcommunity.*gift/i,
  /airdrop.*crypto/i,
  /double.*crypto/i,
  /grabify|iplogger|discord\.gg\/nitro/i,
  /@everyone.*http/i,
];

async function logToStaff(client, text) {
  const id = config.honeypot.logChannelId || config.logChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) ch.send(text).catch(() => {});
}

async function punish(client, message, reason, opts = {}) {
  const member = message.member;
  if (!member || member.user.bot) return false;
  // don't touch mods/admins and owners from ADMIN_DISCORD_IDS
  if (config.adminIds.includes(member.id)) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  // Trap hits hard (default mute 12h), scam filter -- softer.
  const action = opts.action || (opts.trap ? config.honeypot.action : 'timeout');
  const hours = opts.hours ?? (opts.trap ? config.honeypot.timeoutHours : 1);
  const audit = `Honeypot/Automod: ${reason}`;

  // Honestly track if punishment worked -- log shouldn't lie
  let ok = true;
  try {
    if (action === 'ban') {
      await member.ban({ reason: audit });
      try { await message.delete(); } catch {}
    } else if (action === 'kick') {
      await member.kick(audit);
      try { await message.delete(); } catch {}
    } else {
      const ms = Math.min(Math.max(hours, 1), 672) * 60 * 60 * 1000; // 1h..28d
      await member.timeout(ms, audit);
      try { await message.delete(); } catch {}
    }
  } catch (e) {
    ok = false;
    logger.warn('[honeypot] punish failed', member.id, e.message);
  }
  const what = action === 'ban' ? 'ban' : action === 'kick' ? 'kick' : `mute ${hours}h`;
  const { punishLogEmbed } = require('../../utils/embeds');
  if (!ok) {
    await logToStaff(client, `❌ **Honeypot FAILED** (${what} failed -- check bot role/perms): ${member} (${member.id}) -- ${reason}`);
    return false;
  }
  await logToStaff(client, { embeds: [punishLogEmbed({
    what, member: `${member} (${member.id})`, reason, excerpt: (message.content || '').slice(0, 500) || undefined,
  })] });
  return true;
}

async function handleMessage(message, client) {
  const content = message.content || '';

// 1) Trap: public channel, posting forbidden -- first message = punishment.
// Owners from ADMIN_DISCORD_IDS not punished (so you don't mute yourself while setting perms).
  if (config.honeypot.trapChannelId && message.channelId === config.honeypot.trapChannelId) {
    if (config.adminIds.includes(message.author.id)) return;
    await punish(client, message, 'message in honeypot trap', { trap: true });
    return;
  }

  // 2) Flood: N messages in M seconds
  if (hitFlood(message)) {
    await punish(client, message, 'flood', { hours: config.automod.actionHours });
    return;
  }

  // 2.5) Links not in whitelist / invites / badwords
  const linkHit = checkLinks(message);
  if (linkHit) {
    await punish(client, message, linkHit, { hours: config.automod.actionHours });
    try { await message.author.send('⚠️ Link removed by HPSB automod. Allowed domains + own server. Questions -- via ModCall.'); } catch {}
    return;
  }
  if (SCAM_PATTERNS.some(re => re.test(content))) {
    await punish(client, message, 'scam pattern (nitro/gift/airdrop)');
    try { await message.author.send('⚠️ Your message on HPSB removed as suspicious (scam filter). If this is a mistake -- use ModCall.'); } catch {}
    return;
  }

  // 3) Caps (delete + log, no mute -- false positives happen)
  if (checkCaps(content)) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)
      && !config.adminIds.includes(message.author.id)) {
      try { await message.delete(); } catch {}
      await logToStaff(client, `🔠 **Automod (caps)**: ${message.author} (${message.author.id}) in <#${message.channelId}>\n${content.slice(0, 300)}`);
    }
    return;
  }

  // 4) Mass-mention from non-mod
  const mentionsEveryone = message.mentions?.everyone;
  const manyMentions = (message.mentions?.users?.size || 0) >= 5;
  if ((mentionsEveryone || manyMentions) && !message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await punish(client, message, 'mass ping');
  }
}

module.exports = { handleMessage, ensureTrapWarning, joinBeat };

// Keeps RF-style warning in public trap (red embed + banner).
// Called on startup; no spam -- checks recent messages by footer marker.
async function ensureTrapWarning(client) {
  const id = config.honeypot.trapChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch?.isTextBased()) return;
  try {
    const { honeypotEmbed } = require('../../utils/embeds');
    const recent = await ch.messages.fetch({ limit: 10 }).catch(() => null);
    const hasOurs = recent?.some(m =>
      m.author.id === client.user.id &&
      (m.content.includes('HPSB-HONEYPOT') || m.embeds?.[0]?.footer?.text?.includes('HPSB-HONEYPOT'))
    );
    if (hasOurs) return;
    const action = config.honeypot.action;
    const what = action === 'ban' ? 'ban' : action === 'kick' ? 'kick' : `mute ${config.honeypot.timeoutHours}h`;
    await ch.send({ embeds: [honeypotEmbed({ punishment: what, banner: config.honeypot.bannerUrl || undefined })] });
  } catch (e) { logger.warn('[honeypot] warn failed', e.message); }
}

// ---------- Automod helpers ----------

// Flood: more than floodCount messages in floodSecs seconds (memory only in RAM)
const floodMap = new Map(); // userId -> [timestamps]
function hitFlood(message) {
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;
  if (config.adminIds.includes(message.author.id)) return false;
  const now = Date.now();
  const win = Math.max(config.automod.floodSecs, 3) * 1000;
  const arr = (floodMap.get(message.author.id) || []).filter(t => now - t < win);
  arr.push(now);
  floodMap.set(message.author.id, arr);
  if (floodMap.size > 5000) floodMap.clear();
  return arr.length > Math.max(config.automod.floodCount, 2);
}

function hostOf(url) {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ''; }
}

// Returns reason or null
function checkLinks(message) {
  const content = message.content || '';
  const hasInvite = /discord\.gg\/|discord\.com\/invite|discord\.app\.com\/invite/i.test(content);
  const urls = content.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  const wl = config.automod.linkWhitelist.map(d => d.toLowerCase());

  if (hasInvite && config.automod.invites) {
    // invite code can't be verified without extra request -- block all;
    // moderation exempted in punish()
    return 'invite to external server';
  }
  if (config.automod.links && urls.length) {
    const bad = urls.some(u => {
      const h = hostOf(u).replace(/^www\./, '');
      return h && !wl.some(w => h === w || h.endsWith(`.${w}`));
    });
    if (bad) return 'link outside whitelist';
  }
  const low = content.toLowerCase();
  if (config.automod.badwords.length && config.automod.badwords.some(w => low.includes(w))) {
    return 'forbidden word';
  }
  return null;
}

function checkCaps(content) {
  const letters = (content.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  if (letters < Math.max(config.automod.capsMinLen, 4)) return false;
  const upper = (content.match(/[A-ZА-ЯЁ]/g) || []).length;
  return (upper / letters) * 100 >= (config.automod.capsPct || 75);
}

// ---------- Anti-raid: join spike ----------
// Returns 'raid' if raid mode active (newcomer must be muted), else 'ok'.
const joinTimes = [];
let raidUntil = 0;
function joinBeat(member, client) {
  const cfg = config.antiraid;
  if (!cfg || !cfg.joins) return 'ok';
  const now = Date.now();
  joinTimes.push(now);
  while (joinTimes.length && now - joinTimes[0] > Math.max(cfg.secs, 5) * 1000) joinTimes.shift();
  if (joinTimes.length > 500) joinTimes.splice(0, joinTimes.length - 500);
  if (raidUntil > now) return 'raid';
  if (joinTimes.length >= cfg.joins) {
    raidUntil = now + 10 * 60 * 1000;
    joinTimes.length = 0;
    logToStaff(client, `🚨 **Anti-raid ON**: join spike (>=${cfg.joins} in ${cfg.secs}s). Newcomers muted for ${cfg.hours}h, mode 10 min.`)
      .catch(() => {});
    return 'raid';
  }
  return 'ok';
}
