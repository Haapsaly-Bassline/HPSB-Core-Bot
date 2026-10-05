const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requirePower, resolveMember, botMember, protectedTarget, modLog, replyError } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Unmute')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true)),
  async execute(interaction, client) {
    if (!await requirePower(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;
    const user = interaction.options.getUser('user', true);
    const member = await resolveMember(interaction, user);
    if (!member) { await interaction.reply({ content: '❌ User is not on the server.', flags: MessageFlags.Ephemeral }); return; }
    const blocked = protectedTarget(member, interaction.member, await botMember(interaction));
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
    try {
      await member.timeout(null, `Unmute by ${interaction.user.tag}`);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('unmute', { target: `${user} (${user.id})`, mod: `${interaction.user}` });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await replyError(interaction, '❌ Could not unmute.');
    }
  },
};
