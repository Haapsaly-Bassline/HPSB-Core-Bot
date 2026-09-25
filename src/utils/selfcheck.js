// Самопроверка прав: при старте (аудит) и перед заходом в войс (префлайт).
// Никаких плейсхолдеров — всё читается живьём из Discord API.
const { PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');
const { logger } = require('./logger');

const LABELS = new Map([
  [PermissionFlagsBits.ViewChannel, 'Просмотр канала'],
  [PermissionFlagsBits.SendMessages, 'Отправка сообщений'],
  [PermissionFlagsBits.EmbedLinks, 'Вставка ссылок/эмбедов'],
  [PermissionFlagsBits.ReadMessageHistory, 'Чтение истории'],
  [PermissionFlagsBits.Connect, 'Подключение к войсу'],
  [PermissionFlagsBits.Speak, 'Говорить в войсе'],
  [PermissionFlagsBits.ManageChannels, 'Управление каналами'],
  [PermissionFlagsBits.ManageMessages, 'Управление сообщениями'],
  [PermissionFlagsBits.ManageRoles, 'Управление ролями'],
  [PermissionFlagsBits.ModerateMembers, 'Мут участников'],
  [PermissionFlagsBits.KickMembers, 'Кик'],
  [PermissionFlagsBits.BanMembers, 'Бан'],
]);

const WANT_GUILD = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
];

function labelOf(flag) {
  return LABELS.get(flag) || String(flag);
}

// Аудит при старте: чего не хватает на сервере. Возвращает { me, missing[] }.
async function auditGuild(client) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    logger.error('[selfcheck] guild not found:', config.guildId);
    return { me: null, missing: [' guild' ] };
  }
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) {
    logger.error('[selfcheck] bot is not a member of guild');
    return { me: null, missing: ['membership'] };
  }
  const missing = WANT_GUILD.filter(f => !me.permissions.has(f)).map(labelOf);
  if (missing.length) logger.warn('[selfcheck] missing guild perms:', missing.join(', '));
  else logger.info('[selfcheck] guild perms OK');
  return { me, missing };
}

// Префлайт войса: эффективные права именно в этом канале + лимит + мьют бота.
// Поддерживает обычные войсы (2) и сцены Stage (13) — на сцене Speak не требуем,
// бот после входа пробует стать спикером (unsuppress).
// Возвращает { ok, problems[], me, isStage }
async function checkVoice(client, voiceChannel) {
  const problems = [];
  const guild = voiceChannel.guild;
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) return { ok: false, problems: ['бота нет на сервере'], me: null, isStage: false };
  const isStage = voiceChannel.type === 13;
  const eff = voiceChannel.permissionsFor(me);
  const need = isStage
    ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
  for (const f of need) {
    if (!eff?.has(f)) problems.push(`нет права «${labelOf(f)}» в канале ${voiceChannel.name}`);
  }
  if (voiceChannel.userLimit > 0 && voiceChannel.members.size >= voiceChannel.userLimit && !voiceChannel.members.has(me.id)) {
    problems.push(`канал ${voiceChannel.name} полон (лимит ${voiceChannel.userLimit})`);
  }
  if (me.voice.serverMute) problems.push('бот замьючен на сервере (Server Mute)');
  if (me.voice.serverDeaf) problems.push('бот оглушён на сервере (Server Deaf)');
  return { ok: problems.length === 0, problems, me, isStage };
}

module.exports = { auditGuild, checkVoice, labelOf };
