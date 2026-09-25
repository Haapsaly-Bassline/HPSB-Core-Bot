const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Пропустить текущий трек'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q?.isPlaying()) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    q.node.skip();
    await interaction.reply('⏭ Пропущено.');
  },
};
