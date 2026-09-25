const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('clear').setDescription('Очистить очередь (текущий трек продолжает играть)'),
  async execute(interaction, client) {
    if (!await music.clear(client, interaction.guildId)) {
      await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply('🧹 Очередь очищена.');
  },
};
