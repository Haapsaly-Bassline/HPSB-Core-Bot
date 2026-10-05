const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
const { ack } = require('../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop and leave voice'),
  async execute(interaction, client) {
    if (!await music.stop(client, interaction.guildId)) {
      await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral });
      return;
    }
    try { require('../modules/music/np').finalize(client, interaction.guildId, 'Stopped'); } catch {}
    await interaction.reply({ embeds: [ack('⏹ Stopped', 'Left the voice channel.')] });
  },
};
