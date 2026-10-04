const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { snapshot } = require('../modules/stats/counter');

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU'); }

module.exports = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Server online statistics'),
  async execute(interaction, client) {
    await interaction.deferReply();
    const s = await snapshot(client).catch(() => null);
    if (!s) { await interaction.editReply('❌ Could not gather statistics.'); return; }
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`📊 ${interaction.guild.name}`)
      .setThumbnail(interaction.guild.iconURL({ size: 128 }))
      .addFields(
        { name: '👥 Members', value: fmt(s.total), inline: true },
        { name: '🧍 Humans', value: fmt(s.humans), inline: true },
        { name: '🤖 Bots', value: fmt(s.bots), inline: true },
        { name: s.presenceSeen ? '🟢 Online' : '🟢 Online (?)', value: s.presenceSeen ? fmt(s.online) : 'enable Presence Intent', inline: true },
        { name: '⚫ Offline', value: s.presenceSeen ? fmt(s.offline) : '-', inline: true },
        { name: '🎭 Roles', value: fmt(s.roles), inline: true },
        { name: '📁 Channels', value: fmt(s.channels), inline: true },
        { name: '💎 Boosts', value: `${s.boosts} (lvl ${s.tier})`, inline: true },
        { name: '🎖 In role', value: fmt(s.role), inline: true },
      )
      .setFooter({ text: 'Haapsaly Bassline • Stats' })
      .setTimestamp();
    await interaction.editReply({ embeds: [e] });
  },
};
