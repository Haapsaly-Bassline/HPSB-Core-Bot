const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { fmtMs, queueTotalMs } = require('../utils/music');

const LOOP_NAMES = ['Off', 'Track', 'Queue', 'Autoplay'];

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Показать очередь'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q || (!q.currentTrack && q.tracks.size === 0)) {
      await interaction.reply({ content: '📭 Очередь пуста.', flags: MessageFlags.Ephemeral }); return;
    }
    const list = q.tracks.data.slice(0, 15).map((t, i) =>
      `\`${i + 1}.\` **[${t.title}](${t.url})** — ${t.author || ''} \`${t.duration || ''}\``
    );
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('🎧 Очередь')
      .setDescription(
        `**Сейчас:** [${q.currentTrack?.title || '—'}](${q.currentTrack?.url || interaction.channel.url})\n\n` +
        (list.join('\n').slice(0, 3500) || '_дальше пусто_')
      )
      .setFooter({ text: `Треков дальше: ${q.tracks.size} • Всего времени: ${fmtMs(queueTotalMs(q))} • Repeat: ${LOOP_NAMES[q.repeatMode] ?? q.repeatMode} • Haapsaly Bassline` })
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
