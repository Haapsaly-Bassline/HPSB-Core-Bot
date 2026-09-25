const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Перемешать очередь'),
  async execute(interaction, client) {
    const v = music.queueView(client, interaction.guildId);
    if (!v || v.size === 0) {
      await interaction.reply({ content: '❌ Очередь пуста.', flags: MessageFlags.Ephemeral }); return;
    }
    await music.shuffle(client, interaction.guildId);
    await interaction.reply(`🔀 Перемешано треков: ${v.size}.`);
  },
};
