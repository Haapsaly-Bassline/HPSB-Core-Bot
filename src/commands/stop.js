const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Остановить и выйти из войса'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    q?.delete();
    await interaction.reply('⏹ Остановлено.');
  },
};
