const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const music = require('../modules/music/service');
const { fmtMs, progressBar } = require('../utils/music');
module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Что сейчас играет (снимок)'),
  async execute(interaction, client) {
    const snap = music.npSnapshot(client, interaction.guildId);
    if (!snap) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    const t = snap.track;
    const e = new EmbedBuilder().setColor(0x1db954).setTitle('▶️ Сейчас играет').setTimestamp()
      .setDescription(`${/^https?:\/\//i.test(t.url || '') ? `[${t.title}](${t.url})` : `**${t.title}**`}\n${t.author || ''}`.slice(0, 3500));
    if (t.thumbnail) e.setThumbnail(t.thumbnail);
    const left = snap.durationMs > 0 ? fmtMs(snap.positionMs) : 'LIVE';
    const right = snap.durationMs > 0 ? fmtMs(snap.durationMs) : t.durationLabel || 'LIVE';
    e.addFields({ name: 'Позиция', value: `\`${left}\` ${progressBar(snap.positionMs, snap.durationMs, 14)} \`${right}\`` });
    if (t.requesterTag) e.setFooter({ text: `Requested by ${t.requesterTag}` });
    await interaction.reply({ embeds: [e] });
  },
};
