const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Остановить и выйти из войса'),
  async execute(interaction, client) {
    if (!await music.stop(client, interaction.guildId)) {
      await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral });
      return;
    }
    try { require('../modules/music/np').finalize(client, interaction.guildId, 'Остановлено'); } catch {}
    await interaction.reply('⏹ Остановлено.');
  },
};
