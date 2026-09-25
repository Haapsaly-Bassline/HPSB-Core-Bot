const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, modLog } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Разбанить по ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('userid').setDescription('ID пользователя').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const id = interaction.options.getString('userid', true).trim();
    if (!/^\d{15,25}$/.test(id)) { await interaction.reply({ content: '❌ Похоже не ID.', flags: MessageFlags.Ephemeral }); return; }
    try {
      await interaction.guild.members.unban(id, `Unban by ${interaction.user.tag}: ${interaction.options.getString('reason') || ''}`);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('unban', { target: `\`${id}\``, mod: `${interaction.user}`, reason: interaction.options.getString('reason') || undefined });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await interaction.reply({ content: '❌ Не смог разбанить (нет такого бана?).', flags: MessageFlags.Ephemeral });
    }
  },
};
