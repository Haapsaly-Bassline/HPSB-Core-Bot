const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../config');

// true = can moderate; else replies and returns false.
// Accepts ANY mod permission + moderation role from MOD_ROLE_ID
// (Mods role on server without perms -- without this mods won't pass).
// NOTE: destructive commands (ban/kick/mute/...) use requirePower() below,
// this loose gate is only for warn/purge/panels.
const MOD_PERMS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
];

function hasModRole(member) {
  try {
    return !!config.modRoleId && !!member?.roles?.cache?.has(config.modRoleId);
  } catch { return false; }
}

async function requireMod(interaction) {
  const perms = interaction.memberPermissions;
  const member = interaction.member;
  const ok = config.adminIds.includes(interaction.user.id)
    || hasModRole(member)
    || (perms ? MOD_PERMS.some(f => perms.has(f)) : false);
  if (!ok) {
    await interaction.reply({ content: '❌ Moderation only.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return ok;
}

// Strict gate for destructive commands: Administrator OR the specific
// Discord permission (mod role alone is NOT enough here).
async function requirePower(interaction, flags, label) {
  const list = Array.isArray(flags) ? flags : [flags];
  const perms = interaction.memberPermissions;
  const ok = config.adminIds.includes(interaction.user.id)
    || (perms && (perms.has(PermissionFlagsBits.Administrator) || list.some(f => perms.has(f))));
  if (!ok) {
    await interaction.reply({ content: `❌ Requires **${label}** permission.`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return ok;
}

async function resolveMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function botMember(interaction) {
  try {
    return interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  } catch { return null; }
}

// Hierarchy: blocks self, owners, admins, anyone at/above actor, anyone at/above the bot.
// actor/bot are GuildMembers (or null when unknown -- then that check is skipped,
// EXCEPT bot check which fails closed only when we know positions).
function protectedTarget(target, actor, bot) {
  if (!target) return 'User is not on this server.';
  const guild = target.guild;
  if (actor && target.id === actor.id) return "You can't target yourself.";
  if (config.adminIds.includes(target.id)) return 'Forbidden: bot owner.';
  if (target.id === guild?.ownerId) return 'Forbidden: server owner.';
  if (target.permissions?.has?.(PermissionFlagsBits.Administrator)) return 'Forbidden: administrator.';
  const tPos = target.roles?.highest?.position ?? 0;
  if (bot) {
    const bPos = bot.roles?.highest?.position ?? 0;
    if (tPos >= bPos) return "Forbidden: my highest role is not above theirs (I can't touch them).";
  }
  if (actor && actor.id !== guild?.ownerId) {
    const aPos = actor.roles?.highest?.position ?? 0;
    if (tPos >= aPos) return 'Forbidden: they outrank you or are equal.';
  }
  return null;
}

// Safe error reply: respects deferred/replied state, never throws itself.
async function replyError(interaction, text) {
  try {
    const payload = { content: text, flags: MessageFlags.Ephemeral };
    if (interaction.deferred) await interaction.editReply(payload).catch(() => {});
    else if (!interaction.replied) await interaction.reply(payload).catch(() => {});
    else await interaction.followUp(payload).catch(() => {});
  } catch {}
}

async function modLog(client, text) {
  const id = config.logChannelId || config.honeypot.logChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) ch.send(text).catch(() => {});
}

module.exports = { requireMod, requirePower, hasModRole, resolveMember, botMember, protectedTarget, replyError, modLog };
