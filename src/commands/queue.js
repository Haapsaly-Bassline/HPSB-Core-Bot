const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const music = require('../modules/music/service');
const { fmtMs } = require('../utils/music');

const LOOP_NAMES = ['Off', 'Track', 'Queue'];

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue'),
  async execute(interaction, client) {
    const v = music.queueView(client, interaction.guildId);
    if (!v) { await interaction.reply({ content: '📭 Queue is empty.', flags: MessageFlags.Ephemeral }); return; }
    const list = v.upcoming.map(t =>
      `\`${t.n}.\` **[${t.title}](${t.url || interaction.channel.url})** - ${t.author || ''} \`${t.durationLabel || ''}\``
    );
    const cur = v.current;
    const e = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('🎧 Queue')
      .setDescription(
        `**Now playing:** [${cur?.title || '-'}](${cur?.url || interaction.channel.url})\n\n` +
        (list.join('\n').slice(0, 3500) || '_nothing up next_')
      )
      .setFooter({ text: `Up next: ${v.size} • Total time: ${fmtMs(v.totalMs)} • Repeat: ${LOOP_NAMES[v.repeatMode] ?? v.repeatMode} • Haapsaly Bassline` })
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
