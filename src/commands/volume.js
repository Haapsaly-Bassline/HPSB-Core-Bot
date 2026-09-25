const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Громкость 0–200')
    .addIntegerOption(o => o.setName('level').setDescription('0–200').setRequired(true).setMinValue(0).setMaxValue(200)),
  async execute(interaction, client) {
    const level = interaction.options.getInteger('level', true);
    if (await music.volume(client, interaction.guildId, level)) {
      await interaction.reply(`🔊 Громкость: ${level}%.`);
    } else {
      await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral });
    }
  },
};
