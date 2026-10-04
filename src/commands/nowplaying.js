const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('What is playing now (snapshot)'),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral }); return; }
    // Same overlay as live Now Playing (no buttons -- this is a static snapshot)
    const { buildEmbed } = require('../modules/music/np');
    await interaction.reply({ embeds: [buildEmbed(snap)] });
  },
};
