const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Продолжить'),
  async execute(interaction, client) {
    if (!await music.pause(client, interaction.guildId, false)) {
      await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply('▶️ Продолжаем.');
  },
};
