const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('move').setDescription('Переместить трек в очереди')
    .addIntegerOption(o => o.setName('from').setDescription('Какой номер двигаем').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('to').setDescription('На какую позицию').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    const v = music.queueView(client, interaction.guildId);
    if (!v || v.size === 0) { await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return; }
    if (from > v.size || to > v.size) {
      await interaction.reply({ content: `❌ В очереди всего ${v.size}.`, flags: MessageFlags.Ephemeral }); return;
    }
    const title = v.upcoming[from - 1]?.title || `#${from}`;
    if (!await music.move(client, interaction.guildId, from - 1, to - 1)) {
      await interaction.reply({ content: '❌ Не смог переместить трек.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply(`↕️ **${title}** moved: ${from} → ${to}.`);
  },
};
