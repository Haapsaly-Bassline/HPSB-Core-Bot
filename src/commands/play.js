const { SlashCommandBuilder } = require('discord.js');
const { QueryType, Track } = require('discord-player');
const axios = require('axios');

const DIRECT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen/i;

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

    const { addedTrackEmbed } = require('../utils/embeds');
    const { etaMs, fmtMs } = require('../utils/music');
    const meta = { channel: interaction.channel, requester: interaction.user };

    // --- Bandcamp-страницы: свой резолвер (TralbumData -> прямые mp3) ---
    if (/bandcamp\.com/i.test(query) && !DIRECT_RE.test(query)) {
      try {
        const { resolveBandcamp } = require('../modules/music/bandcamp');
        const bc = await resolveBandcamp(query);
        if (!bc) throw new Error('no streams on page');
        const tracks = bc.tracks.map(t => {
          const tr = new Track(client.player, {
            title: t.title,
            author: bc.artist || 'Bandcamp',
            url: query,
            duration: t.durationMs > 0 ? fmtMs(t.durationMs) : 'LIVE',
            thumbnail: bc.artwork || '',
            requestedBy: interaction.user,
            source: 'arbitrary',
            queryType: QueryType.ARBITRARY,
          });
          tr.raw.engine = t.stream; // движок = прямой mp3
          return tr;
        });
        await client.player.play(voiceChannel, tracks[0], {
          nodeOptions: { metadata: { ...meta } },
          requestedBy: interaction.user,
        });
        const queue = client.player.nodes.get(interaction.guildId);
        if (tracks.length > 1 && queue) queue.addTrack(tracks.slice(1));
        if (tracks.length === 1) {
          await interaction.editReply({ embeds: [addedTrackEmbed(tracks[0], '▶ сейчас', interaction.user, 0, null)] });
        } else {
          await interaction.editReply(
            `💿 **Bandcamp:** ${bc.title || ''} — ${bc.artist || ''}\n` +
            `Треков в очереди: **${tracks.length}**\n` +
            tracks.slice(0, 8).map((t, i) => `${i + 1}. ${t.title}`).join('\n')
          );
        }
      } catch (e) {
        await interaction.editReply(`❌ Bandcamp не отдался: ${String(e.message || e).slice(0, 200)}\nДай прямую mp3-ссылку или зеркало YT/SC.`);
      }
      return;
    }

    // Audiomack-страницы без прямого файла всё ещё не стримятся
    if (/audiomack\.com/i.test(query) && !DIRECT_RE.test(query)) {
      await interaction.editReply(
        '⚠️ Audiomack отдаёт стрим только прямой audio-ссылкой.\n'
        + 'Пришли прямую ссылку на .mp3/.m3u8 либо зеркало на YouTube/SoundCloud.'
      );
      return;
    }

    try {
      await playQuery(client, interaction, voiceChannel, query, meta);
    } catch (e) {
      const msg = String(e.message || e);
      // SoundCloud-URL не резолвится с этого IP — фолбэк: название из oEmbed -> поиск SC
      if (/soundcloud\.com|on\.soundcloud/i.test(query) && /no results/i.test(msg)) {
        try {
          const { data } = await axios.get('https://soundcloud.com/oembed', {
            params: { url: query, format: 'json' }, timeout: 15000,
          });
          const title = `${data.author_name || ''} ${data.title || ''}`.trim();
          if (!title) throw new Error('no oembed');
          await interaction.editReply(`🔎 Прямая ссылка не открылась, ищу «${title.slice(0, 100)}» в SoundCloud…`);
          await playQuery(client, interaction, voiceChannel, title, meta, QueryType.SOUNDCLOUD_SEARCH);
          return;
        } catch {}
      }
      await interaction.editReply(`❌ Не смог включить: ${msg.slice(0, 300)}`);
    }
  },
};

async function playQuery(client, interaction, voiceChannel, query, meta, engine) {
  const { addedTrackEmbed } = require('../utils/embeds');
  const { etaMs } = require('../utils/music');
  const before = client.player.nodes.get(interaction.guildId);
  const waitMs = before ? etaMs(before) : 0;

  const res = await client.player.play(voiceChannel, query, {
    nodeOptions: { metadata: { ...meta } },
    requestedBy: interaction.user,
    searchEngine: engine || (DIRECT_RE.test(query) ? QueryType.ARBITRARY : QueryType.AUTO),
  });
  const { track, queue, searchResult } = res;

  if (searchResult?.hasPlaylist?.()) {
    const pl = searchResult.playlist;
    const n = queue?.tracks?.size ?? pl?.tracks?.length ?? '?';
    // editReply уже мог быть вызван (фолбэк пишет статус) — шлём followUp только если deferred
    const msg = `📃 Плейлист **${pl?.title || 'playlist'}** (${pl?.author || ''}) — добавлено треков: **${n}**.\n${pl?.url || ''}`;
    if (interaction.deferred && !interaction.replied) await interaction.editReply(msg);
    else await interaction.followUp(msg);
    return;
  }

  const upcoming = queue?.tracks?.size ?? null;
  const position = upcoming === 0 ? '▶ сейчас' : upcoming;
  const nextTitle = upcoming > 0 ? queue.tracks.data[0]?.title : null;
  const emb = addedTrackEmbed(track, position, interaction.user, waitMs, nextTitle);
  if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: [emb] });
  else await interaction.followUp({ embeds: [emb] });
}
