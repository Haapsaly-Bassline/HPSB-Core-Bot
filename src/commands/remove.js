const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Remove a track from the queue by number (see /queue)')
    .addIntegerOption(o => o.setName('position').setDescription('Number in the queue (1 = first up next)').setRequired(true).setMinValue(1)),
  async execute(interaction, client) {
    const pos = interaction.options.getInteger('position', true);
    const v = music.queueView(client, interaction.guildId);
    if (!v || v.size === 0) { await interaction.reply({ content: '❌ Queue is empty.', flags: MessageFlags.Ephemeral }); return; }
    if (pos > v.size) { await interaction.reply({ content: `❌ Only ${v.size} in the queue.`, flags: MessageFlags.Ephemeral }); return; }
    const removed = await music.remove(client, interaction.guildId, pos - 1);
    if (!removed) { await interaction.reply({ content: "❌ Couldn't remove the track.", flags: MessageFlags.Ephemeral }); return; }
    const { ack } = require('../utils/embeds');
    await interaction.reply({ embeds: [ack('🗑 Removed', `**${String(removed.title || `#${pos}`).slice(0, 200)}** (was #${pos}).`)] });
  },
};
