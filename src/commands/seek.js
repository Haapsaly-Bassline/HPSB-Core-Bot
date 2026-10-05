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
      const { ack, COLORS } = require('../utils/embeds');
      const { progressBar } = require('../utils/music');
      const total = snap.durationMs > 0 ? snap.durationMs : ms;
      await interaction.reply({ embeds: [ack('⏩ Seeked', `\`${fmtMs(ms)}\` ${progressBar(ms, total, 12)} \`${fmtMs(total)}\``, { color: COLORS.music })] });
    } else {
      await interaction.reply({ content: '❌ Seeking is not supported for this source.', flags: MessageFlags.Ephemeral });
    }
  },
};
