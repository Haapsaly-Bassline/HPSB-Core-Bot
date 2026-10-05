const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Volume 0–200')
    .addIntegerOption(o => o.setName('level').setDescription('0–200').setRequired(true).setMinValue(0).setMaxValue(200)),
  async execute(interaction, client) {
    const level = interaction.options.getInteger('level', true);
    if (await music.volume(client, interaction.guildId, level)) {
      const { ack } = require('../utils/embeds');
      const { progressBar } = require('../utils/music');
      await interaction.reply({ embeds: [ack('🔊 Volume', `\`${level}%\` ${progressBar(level, 200, 10)}`)] });
    } else {
      await interaction.reply({ content: '❌ The queue is empty.', flags: MessageFlags.Ephemeral });
    }
  },
};
