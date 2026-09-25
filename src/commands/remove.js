const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Убрать трек из очереди по номеру (см. /queue)')
    .addIntegerOption(o => o.setName('position').setDescription('Номер из очереди (1 = первый дальше)').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const pos = interaction.options.getInteger('position', true);
    const v = music.queueView(client, interaction.guildId);
    if (!v || v.size === 0) { await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return; }
    if (pos > v.size) { await interaction.reply({ content: `❌ В очереди всего ${v.size}.`, flags: MessageFlags.Ephemeral }); return; }
    const removed = await music.remove(client, interaction.guildId, pos - 1);
    if (!removed) { await interaction.reply({ content: '❌ Не смог убрать трек.', flags: MessageFlags.Ephemeral }); return; }
    await interaction.reply(`🗑 Убран: **${removed.title || `#${pos}`}**.`);
  },
};
