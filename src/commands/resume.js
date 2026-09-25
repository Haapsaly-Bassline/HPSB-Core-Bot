const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Продолжить'),
  async execute(interaction, client) {
    client.player.nodes.get(interaction.guildId)?.node.setPaused(false);
    await interaction.reply('▶️ Продолжаем.');
  },
};
