const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('move').setDescription('Move a track in the queue')
    .addIntegerOption(o => o.setName('from').setDescription('Which number to move').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('to').setDescription('To which position').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    const v = music.queueView(client, interaction.guildId);
    if (!v || v.size === 0) { await interaction.reply({ content: '❌ Queue is empty.', flags: MessageFlags.Ephemeral }); return; }
    if (from > v.size || to > v.size) {
      await interaction.reply({ content: `❌ Only ${v.size} in the queue.`, flags: MessageFlags.Ephemeral }); return;
    }
    const title = v.upcoming[from - 1]?.title || `#${from}`;
    if (!await music.move(client, interaction.guildId, from - 1, to - 1)) {
      await interaction.reply({ content: "❌ Couldn't move the track.", flags: MessageFlags.Ephemeral }); return;
    }
    const { ack } = require('../utils/embeds');
    await interaction.reply({ embeds: [ack('↕️ Moved', `**${String(title).slice(0, 200)}**: ${from} → ${to}.`)] });
  },
};
