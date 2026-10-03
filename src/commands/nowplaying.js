const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Что сейчас играет (снимок)'),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    // Тот же оверлей, что и живой Now Playing (без кнопок — это статичный снимок)
    const { buildEmbed } = require('../modules/music/np');
    await interaction.reply({ embeds: [buildEmbed(snap)] });
  },
};
