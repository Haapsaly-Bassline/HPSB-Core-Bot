const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { snapshot } = require('../modules/stats/counter');

function fmt(n) { return Number(n || 0).toLocaleString('ru-RU'); }

module.exports = {
  data: new SlashCommandBuilder().setName('stats').setDescription('Онлайн-статистика сервера'),
  async execute(interaction, client) {
    await interaction.deferReply();
    const s = await snapshot(client).catch(() => null);
    if (!s) { await interaction.editReply('❌ Не смог собрать статистику.'); return; }
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`📊 ${interaction.guild.name}`)
      .setThumbnail(interaction.guild.iconURL({ size: 128 }))
      .addFields(
        { name: '👥 Участники', value: fmt(s.total), inline: true },
        { name: '🧍 Люди', value: fmt(s.humans), inline: true },
        { name: '🤖 Боты', value: fmt(s.bots), inline: true },
        { name: '💎 Бусты', value: `${s.boosts} (ур. ${s.tier})`, inline: true },
        { name: '📁 Каналы', value: fmt(s.channels), inline: true },
        { name: '🎭 Роли', value: fmt(s.roles), inline: true },
      )
      .setFooter({ text: 'Haapsaly Bassline • Stats' })
      .setTimestamp();
    await interaction.editReply({ embeds: [e] });
  },
};
