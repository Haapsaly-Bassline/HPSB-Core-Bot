const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseDuration, fmtMs } = require('../utils/music');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('seek').setDescription('Перемотать текущий трек (1:30 или секунды)')
    .addStringOption(o => o.setName('time').setDescription('Куда мотаем: 1:30 / 90').setRequired(true)),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    const raw = interaction.options.getString('time', true).trim();
    const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : parseDuration(raw);
    if (!ms || ms <= 0) { await interaction.reply({ content: '❌ Формат: `1:30` или секунды `90`.', flags: MessageFlags.Ephemeral }); return; }
    if (await music.seek(client, interaction.guildId, ms)) {
      await interaction.reply(`⏩ Перемотано на ${fmtMs(ms)}.`);
    } else {
      await interaction.reply({ content: '❌ Перемотка не поддерживается для этого источника.', flags: MessageFlags.Ephemeral });
    }
  },
};
