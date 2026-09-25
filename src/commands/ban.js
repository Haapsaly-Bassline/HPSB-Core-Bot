const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, protectedTarget, modLog } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Забанить (с удалением сообщений за N дней)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Кого').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(false))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Удалить сообщения за дней (0–7)').setMinValue(0).setMaxValue(7)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Без причины';
    const member = await resolveMember(interaction, user);
    // забанить можно и вышедшего — тогда проверок иерархии нет, только админы бота
    if (member) {
      const blocked = protectedTarget(member, interaction.user.id);
      if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
    } else if (require('../config').config.adminIds.includes(user.id)) {
      await interaction.reply({ content: '❌ Нельзя: владелец бота.', flags: MessageFlags.Ephemeral }); return;
    }
    try {
      await interaction.guild.members.ban(user.id, {
        reason: `Ban by ${interaction.user.tag}: ${reason}`,
        deleteMessageSeconds: (interaction.options.getInteger('delete_days') || 0) * 86400,
      });
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('ban', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await interaction.reply({ content: '❌ Не смог забанить (роль бота ниже?).', flags: MessageFlags.Ephemeral });
    }
  },
};
