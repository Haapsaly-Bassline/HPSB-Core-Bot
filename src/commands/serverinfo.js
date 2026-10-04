const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Server info'),
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
        { name: 'Members', value: `👥 ${humans} + 🤖 ${bots} = ${g.memberCount}`, inline: true },
        { name: 'Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: 'Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
        { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: 'Boosts', value: `Level ${g.premiumTier} (${g.premiumSubscriptionCount || 0})`, inline: true },
      )
      .setFooter({ text: `ID: ${g.id} • Haapsaly Bassline` })
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
