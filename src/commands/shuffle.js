const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Перемешать очередь'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q?.isPlaying() || q.tracks.size === 0) {
      await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return;
    }
    q.tracks.shuffle();
    await interaction.reply(`🔀 Перемешано треков: ${q.tracks.size}.`);
  },
};
