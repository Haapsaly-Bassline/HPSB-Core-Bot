const { SlashCommandBuilder } = require('discord.js');
const { QueryType } = require('discord-player');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music: YouTube / Spotify / SoundCloud / Bandcamp-direct / Audiomack-direct / file URL')
    .addStringOption(o => o.setName('query').setDescription('Название, ссылка YT/Spotify/SC или прямая mp3/m3u8').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Войс-канал (по умолчанию твой)').setRequired(false)),
  async execute(interaction, client) {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;

    if (!voiceChannel || voiceChannel.type !== 2) {
      await interaction.editReply('❌ Зайди в войс (или укажи канал параметром).');
      return;
    }

    // Tips for sources without extractor
    // Spotify Client ID/Secret бесплатны (developer.spotify.com) — без них тоже играет, но через поиск.
    const needsDirect = /bandcamp\.com|audiomack\.com/i.test(query)
      && !/\.(mp3|ogg|wav|m4a|flac|m3u8)(\?|$)/i.test(query);
    if (needsDirect) {
      await interaction.editReply(
        '⚠️ Bandcamp/Audiomack отдают стрим только прямой audio-ссылкой.\n'
        + 'Пришли мне прямую ссылку на .mp3/.m3u8, либо зеркало на YouTube/SoundCloud — тогда включу без проблем.'
      );
      return;
    }

    try {
      const { addedTrackEmbed } = require('../utils/embeds');
      const { etaMs } = require('../utils/music');
      // ETA считаем ДО добавления — сколько ждать поверх уже стоящего
      const before = client.player.nodes.get(interaction.guildId);
      const waitMs = before ? etaMs(before) : 0;

      const res = await client.player.play(voiceChannel, query, {
        nodeOptions: { metadata: { channel: interaction.channel, requester: interaction.user } },
        requestedBy: interaction.user,
        // Прямые audio-ссылки — только ARBITRARY, иначе резолвер их роняет
        searchEngine: /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen/i.test(query)
          ? QueryType.ARBITRARY
          : QueryType.AUTO,
      });
      const { track, queue, searchResult } = res;

      // Плейлист целиком — как у Jockie: сколько встало в очередь
      if (searchResult?.hasPlaylist?.()) {
        const pl = searchResult.playlist;
        const n = queue?.tracks?.size ?? pl?.tracks?.length ?? '?';
        await interaction.editReply(
          `📃 Плейлист **${pl?.title || 'playlist'}** (${pl?.author || ''}) — добавлено треков: **${n}**.\n${pl?.url || ''}`
        );
        return;
      }

      const upcoming = queue?.tracks?.size ?? null;
      const position = upcoming === 0 ? '▶ сейчас' : upcoming;
      const nextTitle = upcoming > 0 ? queue.tracks.data[0]?.title : null;
      await interaction.editReply({ embeds: [addedTrackEmbed(track, position, interaction.user, waitMs, nextTitle)] });
    } catch (e) {
      await interaction.editReply(`❌ Не смог включить: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
