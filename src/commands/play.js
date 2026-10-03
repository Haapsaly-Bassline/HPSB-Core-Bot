const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play: текст / SoundCloud / Spotify / Deezer / Apple / Tidal / Qobuz / Bandcamp / mp3 / радио')
    .addStringOption(o => o.setName('query').setDescription('Название, ссылка на трек/плейлист или прямая mp3').setRequired(true))
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
      const { addedTrackEmbed, playlistAddedEmbed, liveAddedEmbed } = require('../utils/embeds');
      const res = await music.play(client, voiceChannel, query, {
        requester: interaction.user,
        textChannel: interaction.channel,
      });

      if (res.kind === 'playlist') {
        const emb = playlistAddedEmbed(
          { title: res.playlist.title, count: res.playlist.count, first: res.track },
          interaction.user,
        );
        await interaction.editReply({ embeds: [emb] });
        return;
      }
      // Прямой эфир/радио через /play (mp3-ссылка): оверлей LIVE вместо длительности
      if (res.track.isLive) {
        const emb = liveAddedEmbed(
          { label: res.track.title, url: res.track.url, source: res.track.source },
          interaction.user,
        );
        await interaction.editReply({ embeds: [emb] });
        return;
      }
      const emb = addedTrackEmbed(
        {
          title: res.track.title, url: res.track.url, author: res.track.author,
          thumbnail: res.track.thumbnail, duration: res.track.durationLabel,
          source: res.track.source,
        },
        res.position, interaction.user,
        res.waitMs, res.nextTitle,
      );
      await interaction.editReply({ embeds: [emb] });
    } catch (e) {
      await interaction.editReply(`❌ Не смог включить: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
