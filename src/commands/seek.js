const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseDuration, fmtMs } = require('../utils/music');
module.exports = {
  data: new SlashCommandBuilder().setName('seek').setDescription('Перемотать текущий трек (1:30 или секунды)')
    .addStringOption(o => o.setName('time').setDescription('Куда мотаем: 1:30 / 90').setRequired(true)),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q?.currentTrack) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    const raw = interaction.options.getString('time', true).trim();
    const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : parseDuration(raw);
    if (!ms || ms <= 0) { await interaction.reply({ content: '❌ Формат: `1:30` или секунды `90`.', flags: MessageFlags.Ephemeral }); return; }
    try {
      await q.node.seek(ms);
      await interaction.reply(`⏩ Перемотано на ${fmtMs(ms)}.`);
    } catch {
      await interaction.reply({ content: '❌ Перемотка не поддерживается для этого источника.', flags: MessageFlags.Ephemeral });
    }
  },
};
