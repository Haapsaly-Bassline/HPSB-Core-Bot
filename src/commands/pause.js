const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Пауза'),
  async execute(interaction, client) {
    client.player.nodes.get(interaction.guildId)?.node.setPaused(true);
    await interaction.reply('⏸ Пауза.');
  },
};
