const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Инфо о сервере'),
  async execute(interaction) {
    const g = interaction.guild;
    await g.members.fetch().catch(() => {});
    const humans = g.members.cache.filter(m => !m.user.bot).size;
    const bots = g.members.cache.filter(m => m.user.bot).size;
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`🏠 ${g.name}`)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: 'Участники', value: `👥 ${humans} + 🤖 ${bots} = ${g.memberCount}`, inline: true },
        { name: 'Каналы', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Роли', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Создан', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Владелец', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Бусты', value: `Уровень ${g.premiumTier} (${g.premiumSubscriptionCount || 0})`, inline: true },
      )
      .setFooter({ text: `ID: ${g.id} • Haapsaly Bassline` })
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
