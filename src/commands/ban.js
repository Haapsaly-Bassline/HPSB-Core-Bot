const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requirePower, resolveMember, botMember, protectedTarget, modLog, replyError } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban (deletes messages from the last N days)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete messages from the last N days (0–7)').setMinValue(0).setMaxValue(7)),
  async execute(interaction, client) {
    if (!await requirePower(interaction, PermissionFlagsBits.BanMembers, 'Ban Members')) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason';
    const member = await resolveMember(interaction, user);
    // Absent users can't be hierarchy-checked -- refuse instead of blind banning.
    if (!member) {
      await interaction.reply({ content: '❌ User is not on the server. I cannot verify hierarchy -- ask an administrator to ban manually.', flags: MessageFlags.Ephemeral });
      return;
    }
    const blocked = protectedTarget(member, interaction.member, await botMember(interaction));
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
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
      await replyError(interaction, '❌ Could not ban (bot role too low?).');
    }
  },
};
