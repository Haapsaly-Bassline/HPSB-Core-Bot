const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play: YouTube / Spotify / SoundCloud / Bandcamp / прямые mp3 / радио')
    .addStringOption(o => o.setName('query').setDescription('Название, ссылка или прямая mp3/m3u8').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Войс-канал (по умолчанию твой)').setRequired(false)),
  async execute(interaction, client) {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;

    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.editReply('❌ Зайди в войс или на сцену (или укажи канал параметром).');
      return;
    }

    // Префлайт: бот сам проверяет свои права в ЭТОМ войсе
    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.editReply(`❌ Не могу зайти в войс:\n❌ ${pre.problems.join('\n❌ ')}`);
        return;
      }
    } catch {}

    try {
      const { addedTrackEmbed } = require('../utils/embeds');
      const res = await music.play(client, voiceChannel, query, {
        requester: interaction.user,
        textChannel: interaction.channel,
      });

      if (res.kind === 'playlist') {
        const pl = res.playlist;
        await interaction.editReply(
          `📃 Плейлист **${pl.title}** (${pl.author || ''}) — добавлено треков: **${pl.count}**.\n${pl.url || ''}`
        );
        return;
      }
      if (res.kind === 'bandcamp') {
        const a = res.album;
        await interaction.editReply(
          `💿 **Bandcamp:** ${a.title || ''} — ${a.artist || ''}\n` +
          `Треков в очереди: **${a.count}**\n` +
          a.tracks.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join('\n')
        );
        return;
      }
      const emb = addedTrackEmbed(
        {
          title: res.track.title, url: res.track.url, author: res.track.author,
          thumbnail: res.track.thumbnail, duration: res.track.durationLabel,
        },
        res.position, interaction.user,
        res.waitMs, res.nextTitle,
      );
      if (res.viaFallback) {
        await interaction.editReply(`🔎 Прямая ссылка не открылась, включил через поиск: «${String(res.viaFallback).slice(0, 100)}»`);
        await interaction.followUp({ embeds: [emb] });
      } else {
        await interaction.editReply({ embeds: [emb] });
      }
    } catch (e) {
      await interaction.editReply(`❌ Не смог включить: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
