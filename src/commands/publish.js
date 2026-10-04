const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { newsEmbed } = require('../utils/embeds');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Manually publish news/release')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Text').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('Link').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Image URL').setRequired(false)),
  async execute(interaction) {
    const channelId = config.webhook.channelId || config.siteApi.channelId || interaction.channelId;
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => interaction.channel);
    await channel.send({
      embeds: [newsEmbed({
        title: interaction.options.getString('title', true),
        description: interaction.options.getString('description', true),
        url: interaction.options.getString('url') || undefined,
        image: interaction.options.getString('image') || undefined,
        source: `manual by ${interaction.user.tag}`,
      })],
    });
    await interaction.reply({ content: `✅ Published in <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  },
};
