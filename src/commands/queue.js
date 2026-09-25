const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const music = require('../modules/music/service');
const { fmtMs } = require('../utils/music');

const LOOP_NAMES = ['Off', 'Track', 'Queue', 'Autoplay'];

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Показать очередь'),
  async execute(interaction, client) {
    const v = music.queueView(client, interaction.guildId);
    if (!v) { await interaction.reply({ content: '📭 Очередь пуста.', flags: MessageFlags.Ephemeral }); return; }
    const list = v.upcoming.map(t =>
      `\`${t.n}.\` **[${t.title}](${t.url || interaction.channel.url})** — ${t.author || ''} \`${t.durationLabel || ''}\``
    );
    const cur = v.current;
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('🎧 Очередь')
      .setDescription(
        `**Сейчас:** [${cur?.title || '—'}](${cur?.url || interaction.channel.url})\n\n` +
        (list.join('\n').slice(0, 3500) || '_дальше пусто_')
      )
      .setFooter({ text: `Треков дальше: ${v.size} • Всего времени: ${fmtMs(v.totalMs)} • Repeat: ${LOOP_NAMES[v.repeatMode] ?? v.repeatMode} • Haapsaly Bassline` })
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
