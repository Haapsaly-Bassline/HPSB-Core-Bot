const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('clear').setDescription('Очистить очередь (текущий трек продолжает играть)'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q) { await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return; }
    q.tracks.clear();
    await interaction.reply('🧹 Очередь очищена.');
  },
};
