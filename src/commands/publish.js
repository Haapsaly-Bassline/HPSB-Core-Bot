const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { newsEmbed } = require('../utils/embeds');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Вручную опубликовать новость/релиз')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('title').setDescription('Заголовок').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Текст').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('Ссылка').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Картинка URL').setRequired(false)),
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
    await interaction.reply({ content: `✅ Опубликовано в <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  },
};
