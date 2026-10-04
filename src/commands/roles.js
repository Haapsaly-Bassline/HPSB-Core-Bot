const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { requireMod } = require('../utils/mod');

const DANGER = [
  ['Administrator', PermissionFlagsBits.Administrator],
  ['Manage Server', PermissionFlagsBits.ManageGuild],
  ['Manage Roles', PermissionFlagsBits.ManageRoles],
  ['Manage Channels', PermissionFlagsBits.ManageChannels],
  ['Kick', PermissionFlagsBits.KickMembers],
  ['Ban', PermissionFlagsBits.BanMembers],
  ['Timeout', PermissionFlagsBits.ModerateMembers],
  ['Mention Everyone', PermissionFlagsBits.MentionEveryone],
  ['Manage Webhooks', PermissionFlagsBits.ManageWebhooks],
];

function dangerOf(role) {
  return DANGER.filter(([, f]) => role.permissions.has(f)).map(([n]) => n);
}

async function ensureMembers(guild) {
  try { await guild.members.fetch(); } catch {}
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Server roles: list, audit, fix')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('list').setDescription('All roles: permissions, members, position'))
    .addSubcommand(s => s.setName('audit').setDescription('What breaks what + fix buttons')),

  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    await ensureMembers(guild);
    const me = await guild.members.fetch(client.user.id).catch(() => null);
    const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);

    if (sub === 'list') {
      const lines = roles.map(r => {
        const n = guild.members.cache.filter(m => m.roles.cache.has(r.id)).size;
        const d = dangerOf(r);
        const tags = [r.managed ? '🤖' : '', r.mentionable ? '📣' : '', r.hoist ? '📌' : ''].join('');
        return `\`${r.position}\` **${r.name}** ${tags} — ${n} members.${d.length ? ` ⚠️ ${d.join(', ')}` : ''} (\`${r.id}\`)`;
      });
      const e = new EmbedBuilder().setColor(0x7c3aed).setTitle(`🎭 Roles: ${roles.length}`).setTimestamp()
        .setDescription(lines.slice(0, 25).join('\n').slice(0, 3900) || '—')
        .setFooter({ text: roles.length > 25 ? 'First 25 + full list as a file' : 'Haapsaly Bassline' });
      const files = [];
      if (roles.length > 25 || lines.join('\n').length > 3900) {
        files.push({ attachment: Buffer.from(lines.join('\n'), 'utf8'), name: 'roles.txt' });
      }
      await interaction.editReply({ embeds: [e], files });
      return;
    }

    // ---------- AUDIT ----------
    const issues = [];   // { text, fix?: { label, customId } }
    const botTop = me?.roles.highest;

    // 1) Who has Administrator
    const admins = roles.filter(r => r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator));
    for (const r of admins) {
      const holders = guild.members.cache.filter(m => m.roles.cache.has(r.id) && !m.user.bot).size;
      const human = `**${r.name}** — Administrator, held by ${holders} members.`;
      if (botTop && r.position < botTop.position && !r.managed) {
        issues.push({ text: `🔴 ${human}\nUnneeded admin? Press — I will remove Administrator (other permissions stay).`, fix: { label: `Remove admin: ${r.name.slice(0, 40)}`, customId: `roles:fix:admin:${r.id}` } });
      } else {
        issues.push({ text: `🟡 ${human}\nRole is above/at bot level — fix manually in server settings.` });
      }
    }
    // @everyone separately
    const everyone = guild.roles.everyone;
    if (everyone && dangerOf(everyone).length) {
      issues.push({ text: `🔴 @everyone has dangerous permissions: ${dangerOf(everyone).join(', ')} — this should not happen!` });
    }

    // 2) Hierarchy: bot below mod roles = punish fails
    if (botTop) {
      const above = roles.filter(r => !r.managed && r.id !== guild.id && r.position > botTop.position
        && (r.permissions.has(PermissionFlagsBits.ManageMessages) || r.permissions.has(PermissionFlagsBits.ModerateMembers)
          || r.permissions.has(PermissionFlagsBits.KickMembers) || r.permissions.has(PermissionFlagsBits.BanMembers)
          || r.permissions.has(PermissionFlagsBits.Administrator)));
      if (above.length) {
        issues.push({ text: `🔴 Bot role (**${botTop.name}**, pos. ${botTop.position}) is BELOW: ${above.map(r => `**${r.name}** (${r.position})`).join(', ')}\nThe bot will not be able to mute/kick/ban their holders. Manual fix only: drag the bot role higher in Settings → Roles.` });
      } else {
        issues.push({ text: `🟢 Hierarchy OK: bot role **${botTop.name}** is above all mod roles.` });
      }
    }

    // 3) Empty roles (trash)
    const empty = roles.filter(r => r.id !== guild.id && !r.managed && dangerOf(r).length === 0
      && guild.members.cache.filter(m => m.roles.cache.has(r.id)).size === 0);
    if (empty.length) {
      issues.push({ text: `⚪ Empty roles with no permissions (${empty.length}): ${empty.slice(0, 10).map(r => `**${r.name}**`).join(', ')}${empty.length > 10 ? '…' : ''}\nUsually safe to delete manually.` });
    }

    // 4) Voice overwrites: who blocks View/Connect/Speak
    const voiceCuts = [];
    for (const ch of guild.channels.cache.values()) {
      if (!ch?.isVoiceBased?.()) continue;
      for (const [roleId, ow] of ch.permissionOverwrites.cache) {
        const denied = [];
        if (ow.deny.has(PermissionFlagsBits.ViewChannel)) denied.push('View');
        if (ow.deny.has(PermissionFlagsBits.Connect)) denied.push('Connect');
        if (ow.deny.has(PermissionFlagsBits.Speak)) denied.push('Speak');
        if (denied.length) {
          const role = guild.roles.cache.get(roleId);
          voiceCuts.push(`#${ch.name} → **${role?.name || roleId}**: no ${denied.join('/')}`);
        }
      }
      if (voiceCuts.length >= 12) break;
    }
    if (voiceCuts.length) issues.push({ text: `🔶 Voice overwrites (who mutes whom):\n${voiceCuts.slice(0, 12).join('\n')}` });
    else issues.push({ text: '🟢 No denies in voice channels.' });

    const e = new EmbedBuilder().setColor(issues.some(i => i.text.startsWith('🔴')) ? 0xef4444 : 0x22c55e)
      .setTitle(`🔍 Roles audit (${issues.length})`).setTimestamp()
      .setDescription(issues.slice(0, 8).map((v, i) => `**${i + 1}.** ${v.text}`).join('\n\n').slice(0, 3900) || 'Clean.')
      .setFooter({ text: 'Haapsaly Bassline • Roles' });

    // fix buttons (max 5 per row)
    const rows = [];
    const fixable = issues.filter(i => i.fix).slice(0, 5);
    if (fixable.length) {
      const row = new ActionRowBuilder();
      for (const i of fixable) {
        row.addComponents(new ButtonBuilder().setCustomId(i.fix.customId).setLabel(i.fix.label.slice(0, 80)).setStyle(ButtonStyle.Danger));
      }
      rows.push(row);
    }
    await interaction.editReply({ embeds: [e], components: rows });
  },

  // Button roles:fix:admin:<roleId> -- remove Administrator, leave the rest
  async handleButton(interaction, client) {
    const [, action, kind, roleId] = interaction.customId.split(':');
    if (action !== 'fix' || kind !== 'admin') return false;
    if (!await requireMod(interaction)) return true;
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) { await interaction.reply({ content: '❌ Role not found.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
    const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
    if (me && role.position >= me.roles.highest.position) {
      await interaction.reply({ content: '❌ Role is above the bot — manual fix only.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
    }
    try {
      await role.setPermissions(role.permissions.remove(PermissionFlagsBits.Administrator), 'Roles audit fix');
      await interaction.reply({ content: `✅ Administrator removed from **${role.name}**. Other permissions intact. Run /roles audit again.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      try {
        const { modLog } = require('../utils/mod');
        await modLog(client, `🎭 **Roles fix** ${interaction.user} removed Administrator from **${role.name}**`);
      } catch {}
    } catch {
      await interaction.reply({ content: '❌ Could not (missing permissions?).', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  },
};
