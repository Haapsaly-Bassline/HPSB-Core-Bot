const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('clear').setDescription('Clear the queue (current track keeps playing)'),
  async execute(interaction, client) {
    if (!await music.clear(client, interaction.guildId)) {
      await interaction.reply({ content: '❌ The queue is empty.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply('🧹 Queue cleared.');
  },
};
