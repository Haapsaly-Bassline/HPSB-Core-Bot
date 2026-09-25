const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Остановить и выйти из войса'),
  async execute(interaction, client) {
    await music.stop(client, interaction.guildId);
    try { require('../modules/music/np').finalize(client, interaction.guildId, 'Остановлено'); } catch {}
    await interaction.reply('⏹ Остановлено.');
  },
};
