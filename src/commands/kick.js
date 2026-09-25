const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, protectedTarget, modLog } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Кикнуть с сервера')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Кого').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Без причины';
    const member = await resolveMember(interaction, user);
    const blocked = member ? protectedTarget(member, interaction.user.id) : 'Пользователь не на сервере.';
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
    try {
      await member.kick(`Kick by ${interaction.user.tag}: ${reason}`);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('kick', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await interaction.reply({ content: '❌ Не смог кикнуть (роль бота ниже?).', flags: MessageFlags.Ephemeral });
    }
  },
};
