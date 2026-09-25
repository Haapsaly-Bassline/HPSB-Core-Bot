const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, modLog } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Кого').setRequired(true)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const member = await resolveMember(interaction, user);
    if (!member) { await interaction.reply({ content: '❌ Пользователь не на сервере.', flags: MessageFlags.Ephemeral }); return; }
    try {
      await member.timeout(null);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('unmute', { target: `${user} (${user.id})`, mod: `${interaction.user}` });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await interaction.reply({ content: '❌ Не смог снять мут.', flags: MessageFlags.Ephemeral });
    }
  },
};
