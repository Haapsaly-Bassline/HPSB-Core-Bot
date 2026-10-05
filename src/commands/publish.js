const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');
const { newsEmbed } = require('../utils/embeds');
const { config } = require('../config');

const URL_RE = /^https?:\/\//i;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Manually publish news/release')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('title').setDescription('Title').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Text').setRequired(true))
    .addStringOption(o => o.setName('url').setDescription('Link (https://…)').setRequired(false))
    .addStringOption(o => o.setName('image').setDescription('Image URL (https://…)').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const url = interaction.options.getString('url') || undefined;
    const image = interaction.options.getString('image') || undefined;
    if ((url && !URL_RE.test(url)) || (image && !URL_RE.test(image))) {
      await interaction.reply({ content: '❌ Link/image must start with `https://`.', flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      const channelId = config.webhook.channelId || config.siteApi.channelId || interaction.channelId;
      const channel = interaction.guild
        ? (await interaction.guild.channels.fetch(channelId).catch(() => null)) || interaction.channel
        : interaction.channel;
      if (!channel?.isTextBased?.()) {
        await interaction.reply({ content: '❌ No text channel to publish into.', flags: MessageFlags.Ephemeral });
        return;
      }
      await channel.send({
        embeds: [newsEmbed({
          title: interaction.options.getString('title', true),
          description: interaction.options.getString('description', true),
          url, image,
          source: `manual by ${interaction.user.tag}`,
        })],
      });
      await interaction.reply({ content: `✅ Published in <#${channel.id}>`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await replyError(interaction, `❌ Publish failed: ${String(e.message || e).slice(0, 200)}`);
    }
  },
};
