const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { config } = require('../config');

// true — можно модерировать; иначе сам отвечает и возвращает false.
// Принимаем ЛЮБОЕ мод-право + роль модерации из MOD_ROLE_ID
// (роль Mods на сервере без прав — без этого моды не проходят).
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
    await interaction.reply({ content: '❌ Только для модерации.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return ok;
}

async function resolveMember(interaction, user) {
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

// иерархия: нельзя трогать равных/выше и ботов выше? минимум — сам себя, владельца, админов и модов
function protectedTarget(target, actorId) {
  if (!target) return 'Пользователь не на сервере.';
  if (target.id === actorId) return 'Нельзя применять к себе.';
  if (config.adminIds.includes(target.id)) return 'Нельзя: владелец бота.';
  if (target.permissions.has(PermissionFlagsBits.Administrator)) return 'Нельзя: администратор.';
  return null;
}

async function modLog(client, text) {
  const id = config.logChannelId || config.honeypot.logChannelId;
  if (!id) return;
  const ch = await client.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased()) ch.send(text).catch(() => {});
}

module.exports = { requireMod, hasModRole, resolveMember, protectedTarget, modLog };
