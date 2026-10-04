const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modcall-panel')
    .setDescription('Publish the moderation contact panel (button)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const targetId = config.modcall.panelChannelId || interaction.channelId;
    const channel = await interaction.guild.channels.fetch(targetId).catch(() => interaction.channel);

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('📞 Contact moderation')
      .setDescription('Press the button below, describe the issue - moderation will reply to your DMs via the bot.\nDo not spam, one open ticket at a time.')
      .setFooter({ text: 'Haapsaly Bassline • ModCall' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('modcall:open').setLabel('Message moderation').setStyle(ButtonStyle.Primary).setEmoji('📩'),
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ Panel published in <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  },
};
