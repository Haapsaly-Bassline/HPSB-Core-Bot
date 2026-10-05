const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

const NAMES = { 0: 'Off ⏹', 1: 'Track 🔂', 2: 'Queue 🔁' };

module.exports = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Repeat mode')
    .addIntegerOption(o => o.setName('mode').setDescription('Repeat mode').setRequired(true)
      .addChoices(
        { name: 'Off', value: 0 },
        { name: 'Track (current on repeat)', value: 1 },
        { name: 'Queue (whole queue)', value: 2 },
      )),
  async execute(interaction, client) {
    const mode = interaction.options.getInteger('mode', true);
    if (!await music.loop(client, interaction.guildId, mode)) {
      await interaction.reply({ content: '❌ The queue is empty.', flags: MessageFlags.Ephemeral }); return;
    }
    const { ack } = require('../utils/embeds');
    await interaction.reply({ embeds: [ack('🔁 Repeat', `**${NAMES[mode] || mode}**`)] });
  },
};
