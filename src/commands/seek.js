const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseDuration, fmtMs } = require('../utils/music');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('seek').setDescription('Seek the current track (1:30 or seconds)')
    .addStringOption(o => o.setName('time').setDescription('Where to seek: 1:30 / 90').setRequired(true)),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral }); return; }
    const raw = interaction.options.getString('time', true).trim();
    const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : parseDuration(raw);
    if (!ms || ms <= 0) { await interaction.reply({ content: '❌ Format: `1:30` or seconds `90`.', flags: MessageFlags.Ephemeral }); return; }
    if (await music.seek(client, interaction.guildId, ms)) {
      await interaction.reply(`⏩ Seeked to ${fmtMs(ms)}.`);
    } else {
      await interaction.reply({ content: '❌ Seeking is not supported for this source.', flags: MessageFlags.Ephemeral });
    }
  },
};
