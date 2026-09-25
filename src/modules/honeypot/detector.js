// Honeypot + базовый автомод против "взломов", скам-ссылок и нюков.
// Публичная ловушка: кто первым пишет в канал — получает наказание (по умолч. мут 12ч).
// Плюс скам-фильтр (nitro/gift/airdrop) и анти масс-пинг.
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
  // не трогаем модов/админов и владельцев из ADMIN_DISCORD_IDS
  if (config.adminIds.includes(member.id)) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  // Ловушка бьёт сильно (по умолчанию мут 12ч), скам-фильтр — мягче.
  const action = opts.action || (opts.trap ? config.honeypot.action : 'timeout');
  const hours = opts.hours ?? (opts.trap ? config.honeypot.timeoutHours : 1);
  const audit = `Honeypot/Automod: ${reason}`;

  // Честно отслеживаем, сработало ли наказание — лог не должен врать
  let ok = true;
  try {
    if (action === 'ban') {
      await member.ban({ reason: audit });
      try { await message.delete(); } catch {}
    } else if (action === 'kick') {
      await member.kick(audit);
      try { await message.delete(); } catch {}
    } else {
      const ms = Math.min(Math.max(hours, 1), 672) * 60 * 60 * 1000; // 1ч..28дн
      await member.timeout(ms, audit);
      try { await message.delete(); } catch {}
    }
  } catch (e) {
    ok = false;
    logger.warn('[honeypot] punish failed', member.id, e.message);
  }
  const what = action === 'ban' ? 'бан' : action === 'kick' ? 'кик' : `мут ${hours}ч`;
  const { punishLogEmbed } = require('../../utils/embeds');
  if (!ok) {
    await logToStaff(client, `❌ **Honeypot FAILED** (${what} не сработал — проверь роль/права бота): ${member} (${member.id}) — ${reason}`);
    return false;
  }
  await logToStaff(client, { embeds: [punishLogEmbed({
    what, member: `${member} (${member.id})`, reason, excerpt: (message.content || '').slice(0, 500) || undefined,
  })] });
  return true;
}

async function handleMessage(message, client) {
  const content = message.content || '';

  // 1) Ловушка: публичный канал, писать в него нельзя — первое сообщение = наказание.
  // Владельцы из ADMIN_DISCORD_IDS не наказываются (чтобы сам себя не замутить при настройке прав).
  if (config.honeypot.trapChannelId && message.channelId === config.honeypot.trapChannelId) {
    if (config.adminIds.includes(message.author.id)) return;
    await punish(client, message, 'сообщение в honeypot-ловушку', { trap: true });
    return;
  }

  // 2) Флуд: N сообщений за M секунд
  if (hitFlood(message)) {
    await punish(client, message, 'флуд', { hours: config.automod.actionHours });
    return;
  }

  // 2.5) Ссылки не из вайтлиста / инвайты / мат
  const linkHit = checkLinks(message);
  if (linkHit) {
    await punish(client, message, linkHit, { hours: config.automod.actionHours });
    try { await message.author.send('⚠️ Ссылка удалена автомодом HPSB. Разрешённые домены + свой сервер. Вопросы — через ModCall.'); } catch {}
    return;
  }
  if (SCAM_PATTERNS.some(re => re.test(content))) {
    await punish(client, message, 'скам-паттерн (nitro/gift/airdrop)');
    try { await message.author.send('⚠️ Твоё сообщение на HPSB удалено как подозрительное (скам-фильтр). Если это ошибка — напиши через ModCall.'); } catch {}
    return;
  }

  // 3) Капс (удаление + лог, без мута — бывают ложные)
  if (checkCaps(content)) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)
      && !config.adminIds.includes(message.author.id)) {
      try { await message.delete(); } catch {}
      await logToStaff(client, `🔠 **Automod (капс)**: ${message.author} (${message.author.id}) в <#${message.channelId}>\n${content.slice(0, 300)}`);
    }
    return;
  }

  // 4) Масс-меншн от немода
  const mentionsEveryone = message.mentions?.everyone;
  const manyMentions = (message.mentions?.users?.size || 0) >= 5;
  if ((mentionsEveryone || manyMentions) && !message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await punish(client, message, 'массовый пинг');
  }
}

module.exports = { handleMessage, ensureTrapWarning, joinBeat };

// Держит в публичной ловушке предупреждение в стиле RF (красный эмбед + баннер).
// Вызывается при старте; не спамит — проверяет последние сообщения по метке в футере.
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
    const what = action === 'ban' ? 'ban' : action === 'kick' ? 'kick' : `мут ${config.honeypot.timeoutHours}ч`;
    await ch.send({ embeds: [honeypotEmbed({ punishment: what, banner: config.honeypot.bannerUrl || undefined })] });
  } catch (e) { logger.warn('[honeypot] warn failed', e.message); }
}

// ---------- Automod helpers ----------

// Флуд: больше floodCount сообщений за floodSecs секунд (память только в RAM)
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

// Возвращает причину или null
function checkLinks(message) {
  const content = message.content || '';
  const hasInvite = /discord\.gg\/|discord\.com\/invite|discord\.app\.com\/invite/i.test(content);
  const urls = content.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  const wl = config.automod.linkWhitelist.map(d => d.toLowerCase());

  if (hasInvite && config.automod.invites) {
    // код инвайта без лишнего запроса не проверить — режем все;
    // модерация exempt'ится в punish()
    return 'инвайт на сторонний сервер';
  }
  if (config.automod.links && urls.length) {
    const bad = urls.some(u => {
      const h = hostOf(u).replace(/^www\./, '');
      return h && !wl.some(w => h === w || h.endsWith(`.${w}`));
    });
    if (bad) return 'ссылка вне вайтлиста';
  }
  const low = content.toLowerCase();
  if (config.automod.badwords.length && config.automod.badwords.some(w => low.includes(w))) {
    return 'запрещённое слово';
  }
  return null;
}

function checkCaps(content) {
  const letters = (content.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  if (letters < Math.max(config.automod.capsMinLen, 4)) return false;
  const upper = (content.match(/[A-ZА-ЯЁ]/g) || []).length;
  return (upper / letters) * 100 >= (config.automod.capsPct || 75);
}

// ---------- Anti-raid: всплеск заходов ----------
// Возвращает 'raid' если рейд-режим активен (новичка надо мутить), иначе 'ok'.
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
    logToStaff(client, `🚨 **Anti-raid ON**: всплеск заходов (≥${cfg.joins} за ${cfg.secs}с). Новички мутятся на ${cfg.hours}ч, режим 10 мин.`)
      .catch(() => {});
    return 'raid';
  }
  return 'ok';
}
