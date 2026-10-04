const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Пауза / продолжить (тоггл)'),
  async execute(interaction, client) {
    let snap = null;
    try { snap = music.npSnapshot(client, interaction.guildId); } catch { snap = null; }
    if (!snap) {
      await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return;
    }
    if (snap.paused) {
      if (!await music.pause(client, interaction.guildId, false)) {
        await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return;
      }
      await interaction.reply('▶️ Продолжаем.');
      return;
    }
    if (!await music.pause(client, interaction.guildId, true)) {
      await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return;
    }
    await interaction.reply('⏸ Пауза.');
  },
};
