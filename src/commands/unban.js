const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, modLog } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban by ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const id = interaction.options.getString('userid', true).trim();
    if (!/^\d{15,25}$/.test(id)) { await interaction.reply({ content: '❌ Does not look like an ID.', flags: MessageFlags.Ephemeral }); return; }
    try {
      await interaction.guild.members.unban(id, `Unban by ${interaction.user.tag}: ${interaction.options.getString('reason') || ''}`);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('unban', { target: `\`${id}\``, mod: `${interaction.user}`, reason: interaction.options.getString('reason') || undefined });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await interaction.reply({ content: '❌ Could not unban (no such ban?).', flags: MessageFlags.Ephemeral });
    }
  },
};
