const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../config');

// true = can moderate; else replies and returns false.
// Accepts ANY mod permission + moderation role from MOD_ROLE_ID
// (Mods role on server without perms -- without this mods won't pass).
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

async function resolveMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

// hierarchy: can't touch same/higher and bots above? minimum -- self, owner, admins and mods
function protectedTarget(target, actorId) {
  if (!target) return 'User not in server.';
  if (target.id === actorId) return "Can't target yourself.";
  if (config.adminIds.includes(target.id)) return "Forbidden: bot owner.";
  if (target.permissions.has(PermissionFlagsBits.Administrator)) return "Forbidden: administrator.";
  return null;
}

async function modLog(client, text) {
  const id = config.logChannelId || config.honeypot.logChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) ch.send(text).catch(() => {});
}

module.exports = { requireMod, hasModRole, resolveMember, protectedTarget, modLog };
