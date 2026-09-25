const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { config } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modcall-panel')
    .setDescription('Опубликовать панель связи с модерацией (кнопка)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const targetId = config.modcall.panelChannelId || interaction.channelId;
    const channel = await interaction.guild.channels.fetch(targetId).catch(() => interaction.channel);

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('📞 Связь с модерацией')
      .setDescription('Нажми кнопку ниже, опиши проблему — модерация ответит тебе в ЛС через бота.\nНе спамь, один открытый тикет за раз.')
      .setFooter({ text: 'Haapsaly Bassline • ModCall' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('modcall:open').setLabel('Написать модерации').setStyle(ButtonStyle.Primary).setEmoji('📩'),
    );

    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ Панель опубликована в <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  },
};
