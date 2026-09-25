const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('move').setDescription('Переместить трек в очереди')
    .addIntegerOption(o => o.setName('from').setDescription('Какой номер двигаем').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('to').setDescription('На какую позицию').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    if (!q || q.tracks.size === 0) { await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return; }
    if (from > q.tracks.size || to > q.tracks.size) {
      await interaction.reply({ content: `❌ В очереди всего ${q.tracks.size}.`, flags: MessageFlags.Ephemeral }); return;
    }
    const track = q.tracks.at(from - 1) || q.tracks.data[from - 1];
    try {
      q.node.move(track, to - 1);
      await interaction.reply(`↕️ **${track?.title || `#${from}`}** moved: ${from} → ${to}.`);
    } catch {
      await interaction.reply({ content: '❌ Не смог переместить трек.', flags: MessageFlags.Ephemeral });
    }
  },
};
