// Self-check permissions: at startup (audit) and before joining voice (preflight).
// No placeholders -- everything read live from Discord API.
const { PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');
const { logger } = require('./logger');

const LABELS = new Map([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.Speak, 'Speak'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ModerateMembers, 'Moderate Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
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

// Startup audit: what's missing on server. Returns { me, missing[] }.
async function auditGuild(client) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    logger.error('[selfcheck] guild not found:', config.guildId);
    return { me: null, missing: ['guild'] };
  }
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) {
    logger.error('[selfcheck] bot is not a member of guild');
    return { me: null, missing: ['membership'] };
  }
  const missing = WANT_GUILD.filter(f => !me.permissions.has(f)).map(labelOf);
  if (missing.length) logger.warn('[selfcheck] missing guild perms:', missing.join(', '));
  else logger.info('[selfcheck] guild perms OK');
  // Roles by ID: missing ones -> pings will be "unknown"
  const roles = {
    'MOD_ROLE_ID (moderation/tickets)': config.modRoleId,
    'ANNOUNCE_ROLE_ID (announcements)': config.announceRoleId,
    'MEDIA_ROLE_ID (media)': config.mediaRoleId || config.announceRoleId,
  };
  // role.members read from MEMBER CACHE -- on startup it's nearly empty,
  // without warmup "empty role" check fires falsely. Warm up with full fetch
  // (needs privileged Server Members Intent in Dev Portal + GuildMembers in index.js).
  let cacheWarmed = false;
  try {
    await guild.members.fetch();
    cacheWarmed = true;
  } catch (e) {
    logger.warn('[selfcheck] failed to warm member cache -- skipping empty role check (enable Server Members Intent in Dev Portal):', e.message);
  }
  for (const [label, id] of Object.entries(roles)) {
    if (!id) {
      missing.push(`${label}: not set`);
      continue;
    }
    const role = await guild.roles.fetch(id).catch(() => null);
    if (!role) {
      missing.push(`${label}: ${id} NOT ON SERVER`);
      logger.warn(`[selfcheck] role missing: ${label} = ${id}`);
    } else if (role.members.size === 0 && /ANNOUNCE|MEDIA/.test(label)) {
      if (!cacheWarmed) continue; // cache not warmed -- silent to avoid false positives
      logger.warn(`[selfcheck] role empty (ping into void): ${label} = ${role.name}`);
      missing.push(`${label}: role empty (${role.name}) -- ping reaches no one`);
    }
  }
  return { me, missing };
}

// Voice preflight: effective permissions in THIS channel + limit + bot mute.
// Supports regular voice (2) and Stage channels (13) -- on stage Speak not required,
// bot tries to become speaker after joining (unsuppress).
// Returns { ok, problems[], me, isStage }
async function checkVoice(client, voiceChannel) {
  const problems = [];
  const guild = voiceChannel.guild;
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) return { ok: false, problems: ['bot not in guild'], me: null, isStage: false };
  const isStage = voiceChannel.type === 13;
  const eff = voiceChannel.permissionsFor(me);
  const need = isStage
    ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
  for (const f of need) {
    if (!eff?.has(f)) problems.push(`missing "${labelOf(f)}" permission in channel ${voiceChannel.name}`);
  }
  if (voiceChannel.userLimit > 0 && voiceChannel.members.size >= voiceChannel.userLimit && !voiceChannel.members.has(me.id)) {
    problems.push(`channel ${voiceChannel.name} is full (limit ${voiceChannel.userLimit})`);
  }
  if (me.voice.serverMute) problems.push('bot is server-muted (Server Mute)');
  if (me.voice.serverDeaf) problems.push('bot is server-deafened (Server Deaf)');
  return { ok: problems.length === 0, problems, me, isStage };
}

module.exports = { auditGuild, checkVoice, labelOf };
