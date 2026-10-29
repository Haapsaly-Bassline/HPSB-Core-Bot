const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseSeekInput, fmtMs, progressBar } = require('../utils/music');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('seek').setDescription('Seek the current track: 1:30, 90, +30 or -15')
    .addStringOption(o => o.setName('time').setDescription('Position (1:30 / 90) or offset (+30 / -15)').setRequired(true)),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral }); return; }
    if (snap.track.isLive || snap.durationMs <= 0) {
      await interaction.reply({ content: '❌ Live streams cannot be seeked.', flags: MessageFlags.Ephemeral });
      return;
    }
    const raw = interaction.options.getString('time', true);
    const parsed = parseSeekInput(raw, { currentMs: snap.positionMs, durationMs: snap.durationMs });
    if (!parsed) {
      await interaction.reply({ content: '❌ Format: `1:30`, `90`, or an offset like `+30` / `-15`.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (await music.seek(client, interaction.guildId, parsed.ms)) {
      const { ack, COLORS } = require('../utils/embeds');
      // Refresh the live NP message right away instead of waiting for the next tick.
      require('../modules/music/np').render(client, interaction.guildId).catch(() => {});
      const total = snap.durationMs > 0 ? snap.durationMs : parsed.ms;
      const delta = parsed.relative ? (parsed.ms >= snap.positionMs ? '+' : '') + `${Math.round((parsed.ms - snap.positionMs) / 1000)}s ` : '';
      await interaction.reply({ embeds: [ack('⏩ Seeked', `${delta}\`${fmtMs(parsed.ms)}\` ${progressBar(parsed.ms, total, 12)} \`${fmtMs(total)}\``, { color: COLORS.music })] });
    } else {
      await interaction.reply({ content: '❌ Seeking is not supported for this source.', flags: MessageFlags.Ephemeral });
    }
  },
};
