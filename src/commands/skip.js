const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Пропустить текущий трек'),
  async execute(interaction, client) {
    if (!await music.skip(client, interaction.guildId)) {
      await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply('⏭ Пропущено.');
  },
};
