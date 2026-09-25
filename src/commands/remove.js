const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Убрать трек из очереди по номеру (см. /queue)')
    .addIntegerOption(o => o.setName('position').setDescription('Номер из очереди (1 = первый дальше)').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    const pos = interaction.options.getInteger('position', true);
    if (!q || q.tracks.size === 0) { await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return; }
    if (pos > q.tracks.size) { await interaction.reply({ content: `❌ В очереди всего ${q.tracks.size}.`, flags: MessageFlags.Ephemeral }); return; }
    const track = q.tracks.at(pos - 1) || q.tracks.data[pos - 1];
    try {
      const removed = q.node.remove(track);
      if (!removed) throw new Error('not removed');
      await interaction.reply(`🗑 Убран: **${track?.title || `#${pos}`}**.`);
    } catch {
      await interaction.reply({ content: '❌ Не смог убрать трек.', flags: MessageFlags.Ephemeral });
    }
  },
};
