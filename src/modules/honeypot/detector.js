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

function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Applied mute length may differ from requested hours (1m floor, 28d ceiling)
// -- the log shows what was actually applied, not the request.
function fmtDur(hours) {
  const ms = Math.min(Math.max(Number(hours) * 60 * 60 * 1000, 60 * 1000), 28 * 86400 * 1000);
  if (ms < 3600 * 1000) return `mute ${Math.round(ms / 60000)}m`;
  if (ms < 24 * 3600 * 1000) return `mute ${Math.round(ms / 3600000)}h`;
  return `mute ${Math.round(ms / 86400000)}d`;
}

// Central staff exemption: bot owner, mod role holders, anyone with mod powers.
// Used by trap, punish, flood, caps, mass-ping -- staff never eats automod.
function isExempt(member, authorId) {
  if (config.adminIds.includes(authorId)) return true;
  if (!member || member.user?.bot) return true;
  try {
    const { hasModRole } = require('../../utils/mod');
    if (hasModRole(member)) return true;
    const p = member.permissions;
    if (p?.has?.(PermissionFlagsBits.ManageMessages)) return true;
    if (p?.has?.(PermissionFlagsBits.KickMembers)) return true;
    if (p?.has?.(PermissionFlagsBits.BanMembers)) return true;
    if (p?.has?.(PermissionFlagsBits.ModerateMembers)) return true;
  } catch {}
  return false;
}

async function punish(client, message, reason, opts = {}) {
  const member = message.member;
  if (!member) return false;
  // Never punish ourselves (our trap warning lives in the trap channel).
  if (message.author.id === client.user?.id) return false;
  // Staff exempt -- but NOT bots: raid/spam bots are the trap's main target.
  // (Bot authors only ever reach punish() through the trap channel.)
  if (!message.author.bot && isExempt(member, member.id)) return false;

  // Trap hits hard (default mute 12h), scam filter -- softer.
  const action = opts.action || (opts.trap ? config.honeypot.action : 'timeout');
  const hours = opts.hours ?? (opts.trap ? config.honeypot.timeoutHours : 1);
  const audit = `Honeypot/Automod: ${reason}`;

  // Honestly track if punishment worked -- log shouldn't lie
  let ok = true;
  let errMsg = '';
  try {
    if (action === 'ban') {
      await member.ban({ reason: audit });
      try { await message.delete(); } catch {}
    } else if (action === 'kick') {
      // Reference behavior (RiskyMH/honeypot): kick = softban -- ban with
      // 24h message wipe + instant unban, so the spammer's recent messages
      // go too, not just the triggering one.
      let kicked = false;
      let stuck = false;
      try {
        await member.ban({ reason: audit, deleteMessageSeconds: 86400 });
        try {
          await message.guild?.members?.unban(member.id, 'Honeypot softban (kick)');
          kicked = true;
        } catch {
          // Ban landed but unban failed (perms/hierarchy): the user is now
          // PERMANENTLY banned, not kicked. Never report this as a kick.
          stuck = true;
        }
      } catch {
        try { await member.kick(audit); kicked = true; } catch {}
      }
      if (stuck) throw new Error('softban STUCK -- user is banned, unban manually');
      if (!kicked) throw new Error('kick failed (need Kick or Ban Members + higher role)');
      try { await message.delete(); } catch {}
    } else {
      const ms = Math.min(Math.max(hours * 60 * 60 * 1000, 60 * 1000), 28 * 86400 * 1000); // 1m..28d
      await member.timeout(ms, audit);
      try { await message.delete(); } catch {}
    }
  } catch (e) {
    ok = false;
    errMsg = String(e?.message || e).slice(0, 200);
    logger.warn('[honeypot] punish failed', member.id, errMsg);
  }
  const what = action === 'ban' ? 'ban' : action === 'kick' ? 'kick' : `mute ${fmtDur(hours)}`;
  const { punishLogEmbed } = require('../../utils/embeds');
  if (!ok) {
    await logToStaff(client, `❌ **Honeypot FAILED** (${what} failed${errMsg ? `: ${errMsg}` : ''} -- check bot role/perms): ${member} (${member.id}) -- ${reason}`);
    return false;
  }
  await logToStaff(client, { embeds: [punishLogEmbed({
    what, member: `${member} (${member.id})`, reason, excerpt: (message.content || '').slice(0, 500) || undefined,
  })] });
  return true;
}

async function handleMessage(message, client) {
  const content = message.content || '';
  const { isEnabled } = require('../manager');
  const huntOn = isEnabled('honeypot');
  const autoOn = isEnabled('automod');
  if (!huntOn && !autoOn) return;

// 1) Trap: public channel, posting forbidden -- first message = punishment.
// Staff exempt (owner, mod role, ManageMessages) -- so you don't mute yourself setting perms.
// Bots are NOT exempt here (raid bots are the main target); our own warning is.
  if (huntOn && config.honeypot.trapChannelId && message.channelId === config.honeypot.trapChannelId) {
    if (message.author.id === client.user?.id) return;
    if (!message.author.bot && isExempt(message.member, message.author.id)) return;
    await punish(client, message, 'message in honeypot trap', { trap: true });
    return;
  }
  if (!autoOn) return;

  // 2) Flood: N messages in M seconds
  if (hitFlood(message)) {
    await punish(client, message, 'flood', { hours: config.automod.actionHours });
    return;
  }

  // 2.5) Links not in whitelist / invites / badwords
  const linkHit = await checkLinks(client, message);
  if (linkHit) {
    await punish(client, message, linkHit, { hours: config.automod.actionHours });
    try { await message.author.send('⚠️ Link removed by HPSB automod. Allowed domains + own server. Questions -- via ModCall.'); } catch {}
    return;
  }
  if (SCAM_PATTERNS.some(re => re.test(content))) {
    if (/(?:https?:\/\/|www\.)[^\s<>()]+/i.test(content)) {
      await punish(client, message, 'scam pattern (nitro/gift/airdrop)');
      try { await message.author.send('⚠️ Your message on HPSB removed as suspicious (scam filter). If this is a mistake -- use ModCall.'); } catch {}
    } else if (!isExempt(message.member, message.author.id)) {
      // Keyword match without any link = likely legit discussion: delete + log, no mute.
      // Staff exempt -- same as caps/mass-ping below.
      try { await message.delete(); } catch {}
      await logToStaff(client, `🔍 **Automod (scam-words, no link)**: ${message.author} (${message.author.id}) in <#${message.channelId}>\n${content.slice(0, 300)}`);
    }
    return;
  }

  // 3) Caps (delete + log, no mute -- false positives happen)
  if (checkCaps(content)) {
    if (!isExempt(message.member, message.author.id)) {
      try { await message.delete(); } catch {}
      await logToStaff(client, `🔠 **Automod (caps)**: ${message.author} (${message.author.id}) in <#${message.channelId}>\n${content.slice(0, 300)}`);
    }
    return;
  }

  // 4) Mass-mention from non-mod
  const mentionsEveryone = message.mentions?.everyone;
  const manyMentions = (message.mentions?.users?.size || 0) >= 5;
  if (mentionsEveryone || manyMentions) {
    if (!isExempt(message.member, message.author.id)) {
      await punish(client, message, 'mass ping');
    }
  }
}

module.exports = { handleMessage, handleTrapMessage, ensureTrapWarning, joinBeat, isExempt };

// Trap-only path for BOT authors: messageCreate ignores bots entirely, so raid
// bots posting in the trap channel would never be punished. Automod proper
// (flood/links/caps) still skips bots -- only the trap acts on them.
async function handleTrapMessage(message, client) {
  try {
    const { isEnabled } = require('../manager');
    if (!isEnabled('honeypot')) return false;
  } catch { return false; }
  if (!message?.guild) return false;
  if (!config.honeypot.trapChannelId || message.channelId !== config.honeypot.trapChannelId) return false;
  if (message.author.id === client.user?.id) return false; // our own warning
  return punish(client, message, 'message in honeypot trap (bot)', { trap: true });
}

// Keeps RF-style warning in public trap (banner on TOP as its own message,
// warning text below -- Discord embeds always render images at the bottom,
// so a single embed can never show the banner first).
// Called on startup; no spam -- checks recent messages by footer marker.
async function ensureTrapWarning(client) {
  const id = config.honeypot.trapChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch?.isTextBased()) return;
  try {
    const { honeypotEmbed } = require('../../utils/embeds');
    const recent = await ch.messages.fetch({ limit: 10 }).catch(() => null);
    const mine = (recent ? [...recent.values()] : []).filter((m) => m.author.id === client.user?.id);
    const hasEmbed = mine.some((m) =>
      (m.content.includes('HPSB-HONEYPOT') || m.embeds?.[0]?.footer?.text?.includes('HPSB-HONEYPOT')));
    if (hasEmbed) return;
    const action = config.honeypot.action;
    const what = action === 'ban' ? 'ban' : action === 'kick' ? 'kick (softban)' : fmtDur(config.honeypot.timeoutHours);
    const banner = config.honeypot.bannerUrl || '';
    // Banner is its own message (no marker): only send when neither the banner
    // nor the warning is present, otherwise banners pile up on restarts.
    const hasBanner = banner && mine.some((m) => m.content === banner);
    if (/^https?:\/\/\S+$/i.test(banner) && !hasBanner) {
      await ch.send(banner).catch(() => {});
    }
    await ch.send({ embeds: [honeypotEmbed({ punishment: what })] });
  } catch (e) { logger.warn('[honeypot] warn failed', e.message); }
}

// ---------- Automod helpers ----------

// Flood: more than floodCount messages in floodSecs seconds, per guild+user.
// LRU eviction of oldest entries (a full clear() would open an evasion window).
const floodMap = new Map(); // `${guildId}:${userId}` -> [timestamps]
const FLOOD_MAX_KEYS = 2000;
function hitFlood(message) {
  if (isExempt(message.member, message.author.id)) return false;
  const now = Date.now();
  const key = `${message.guildId || 'dm'}:${message.author.id}`;
  const win = Math.max(config.automod.floodSecs, 3) * 1000;
  const arr = (floodMap.get(key) || []).filter(t => now - t < win);
  arr.push(now);
  floodMap.delete(key);
  floodMap.set(key, arr); // re-insert = most-recently-used at the end
  while (floodMap.size > FLOOD_MAX_KEYS) {
    const oldest = floodMap.keys().next().value;
    floodMap.delete(oldest);
  }
  return arr.length > Math.max(config.automod.floodCount, 2);
}

function hostOf(url) {
  try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ''; }
}

// Returns reason or null. Own-server invites are allowed (verified via API).
async function checkLinks(client, message) {
  const content = message.content || '';
  const hasInvite = /discord\.gg\/|discord\.com\/invite|discord\.app\.com\/invite/i.test(content);
  const urls = content.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  const wl = config.automod.linkWhitelist.map(d => d.toLowerCase());

  if (hasInvite && config.automod.invites) {
    const allowed = await ownInvite(client, message).catch(() => false);
    if (!allowed) return 'invite to external server';
  }
  if (config.automod.links && urls.length) {
    const bad = urls.some(u => {
      const h = hostOf(u).replace(/^www\./, '');
      return h && !wl.some(w => h === w || h.endsWith(`.${w}`));
    });
    if (bad) return 'link outside whitelist';
  }
  const low = content.toLowerCase();
  if (config.automod.badwords.length) {
    const hit = config.automod.badwords.some(w => {
      const word = String(w || '').trim().toLowerCase();
      return word && new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(content);
    });
    if (hit) return 'forbidden word';
  }
  return null;
}

// True when the message contains an invite to THIS guild (then it's not "external").
async function ownInvite(client, message) {
  try {
    const m = String(message.content || '').match(/discord\.gg\/([A-Za-z0-9-]+)|discord\.com\/invite\/([A-Za-z0-9-]+)/i);
    const code = m?.[1] || m?.[2];
    if (!code) return false;
    const inv = await client.fetchInvite(code).catch(() => null);
    return !!inv && inv.guildId === message.guildId;
  } catch { return false; }
}

function checkCaps(content) {
  // Unicode-aware: õäöü and other Latin-extended letters count, so locals aren't skewed.
  const letters = (String(content).match(/\p{L}/gu) || []).length;
  if (letters < Math.max(config.automod.capsMinLen, 4)) return false;
  const upper = (String(content).match(/\p{Lu}/gu) || []).length;
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
