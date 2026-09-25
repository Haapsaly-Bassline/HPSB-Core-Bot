const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Громкость 0–200')
    .addIntegerOption(o => o.setName('level').setDescription('0–200').setRequired(true).setMinValue(0).setMaxValue(200)),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q) { await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return; }
    const level = interaction.options.getInteger('level', true);
    try {
      q.node.setVolume(level);
      await interaction.reply(`🔊 Громкость: ${level}%.`);
    } catch {
      await interaction.reply({ content: '❌ Не смог выставить громкость.', flags: MessageFlags.Ephemeral });
    }
  },
};
