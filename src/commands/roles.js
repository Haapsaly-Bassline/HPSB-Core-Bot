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
    .setDescription('Роли сервера: список, аудит, починка')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('list').setDescription('Все роли: права, люди, позиция'))
    .addSubcommand(s => s.setName('audit').setDescription('Что кого ломает + кнопки-фиксы')),

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
        return `\`${r.position}\` **${r.name}** ${tags} — ${n} чел.${d.length ? ` ⚠️ ${d.join(', ')}` : ''} (\`${r.id}\`)`;
      });
      const e = new EmbedBuilder().setColor(0x7c3aed).setTitle(`🎭 Роли: ${roles.length}`).setTimestamp()
        .setDescription(lines.slice(0, 25).join('\n').slice(0, 3900) || '—')
        .setFooter({ text: roles.length > 25 ? 'Первые 25 + полный список файлом' : 'Haapsaly Bassline' });
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

    // 1) Кто с администратором
    const admins = roles.filter(r => r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator));
    for (const r of admins) {
      const holders = guild.members.cache.filter(m => m.roles.cache.has(r.id) && !m.user.bot).size;
      const human = `**${r.name}** — Administrator, у ${holders} чел.`;
      if (botTop && r.position < botTop.position && !r.managed) {
        issues.push({ text: `🔴 ${human}\nЛишняя админка? Жми — сниму Administrator (остальные права останутся).`, fix: { label: `Снять админа: ${r.name.slice(0, 40)}`, customId: `roles:fix:admin:${r.id}` } });
      } else {
        issues.push({ text: `🟡 ${human}\nРоль выше/на уровне бота — руками в настройках сервера.` });
      }
    }
    // @everyone отдельно
    const everyone = guild.roles.everyone;
    if (everyone && dangerOf(everyone).length) {
      issues.push({ text: `🔴 @everyone имеет опасные права: ${dangerOf(everyone).join(', ')} — так быть не должно!` });
    }

    // 2) Иерархия: бот ниже мод-ролей = punish упадёт
    if (botTop) {
      const above = roles.filter(r => !r.managed && r.id !== guild.id && r.position > botTop.position
        && (r.permissions.has(PermissionFlagsBits.ManageMessages) || r.permissions.has(PermissionFlagsBits.ModerateMembers)
          || r.permissions.has(PermissionFlagsBits.KickMembers) || r.permissions.has(PermissionFlagsBits.BanMembers)
          || r.permissions.has(PermissionFlagsBits.Administrator)));
      if (above.length) {
        issues.push({ text: `🔴 Роль бота (**${botTop.name}**, поз. ${botTop.position}) НИЖЕ: ${above.map(r => `**${r.name}** (${r.position})`).join(', ')}\nБот не сможет мутить/кикать/банить их носителей. Чинится только руками: перетащи роль бота выше в Настройки → Роли.` });
      } else {
        issues.push({ text: `🟢 Иерархия ок: роль бота **${botTop.name}** выше всех мод-ролей.` });
      }
    }

    // 3) Пустые роли (мусор)
    const empty = roles.filter(r => r.id !== guild.id && !r.managed && dangerOf(r).length === 0
      && guild.members.cache.filter(m => m.roles.cache.has(r.id)).size === 0);
    if (empty.length) {
      issues.push({ text: `⚪ Пустые роли без прав (${empty.length}): ${empty.slice(0, 10).map(r => `**${r.name}**`).join(', ')}${empty.length > 10 ? '…' : ''}\nОбычно безопасно удалить руками.` });
    }

    // 4) Перезаписи войсов: кто кому режет View/Connect/Speak
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
          voiceCuts.push(`#${ch.name} → **${role?.name || roleId}**: нет ${denied.join('/')}`);
        }
      }
      if (voiceCuts.length >= 12) break;
    }
    if (voiceCuts.length) issues.push({ text: `🔶 Перезаписи войсов (что кого глушит):\n${voiceCuts.slice(0, 12).join('\n')}` });
    else issues.push({ text: '🟢 В войсах запретов нет.' });

    const e = new EmbedBuilder().setColor(issues.some(i => i.text.startsWith('🔴')) ? 0xef4444 : 0x22c55e)
      .setTitle(`🔍 Аудит ролей (${issues.length})`).setTimestamp()
      .setDescription(issues.slice(0, 8).map((v, i) => `**${i + 1}.** ${v.text}`).join('\n\n').slice(0, 3900) || 'Чисто.')
      .setFooter({ text: 'Haapsaly Bassline • Roles' });

    // кнопки-фиксы (макс. 5 в ряд)
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

  // Кнопка roles:fix:admin:<roleId> — снять Administrator, остальное не трогаем
  async handleButton(interaction, client) {
    const [, action, kind, roleId] = interaction.customId.split(':');
    if (action !== 'fix' || kind !== 'admin') return false;
    if (!await requireMod(interaction)) return true;
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) { await interaction.reply({ content: '❌ Роль не найдена.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true; }
    const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
    if (me && role.position >= me.roles.highest.position) {
      await interaction.reply({ content: '❌ Роль выше бота — только руками.', flags: MessageFlags.Ephemeral }).catch(() => {}); return true;
    }
    try {
      await role.setPermissions(role.permissions.remove(PermissionFlagsBits.Administrator), 'Roles audit fix');
      await interaction.reply({ content: `✅ У роли **${role.name}** снят Administrator. Остальные права целы. Прогони /roles audit заново.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      try {
        const { modLog } = require('../utils/mod');
        await modLog(client, `🎭 **Roles fix** ${interaction.user} снял Administrator с **${role.name}**`);
      } catch {}
    } catch {
      await interaction.reply({ content: '❌ Не смог (прав не хватает?).', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  },
};
