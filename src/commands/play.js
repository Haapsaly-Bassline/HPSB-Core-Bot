const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play: text search / SoundCloud / Spotify / Deezer / Apple / Tidal / Qobuz / Bandcamp / mp3 / radio')
    .addStringOption(o => o.setName('query').setDescription('Title, track/playlist link, Bandcamp fan profile or direct mp3').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel (defaults to yours)').setRequired(false))
    .addIntegerOption(o => o.setName('count').setDescription('Fan collection: how many releases to take (1-25, default 10)').setMinValue(1).setMaxValue(25).setRequired(false)),
  async execute(interaction, client) {
    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;

    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.editReply('❌ Join a voice channel or stage (or specify one via the channel option).');
      return;
    }

    // Preflight: bot checks its own permissions in THIS voice
    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.editReply(`❌ Can't join that voice channel:\n❌ ${pre.problems.join('\n❌ ')}`);
        return;
      }
    } catch {}

    // Bandcamp fan profile -- this is a collection, not a track (fan import lives here, no separate command)
    try {
      const { FAN_RE } = require('../modules/music/bandcamp-fan');
      if (FAN_RE.test(query.trim())) {
        const { fanCollectionEmbed } = require('../utils/embeds');
        const limit = interaction.options.getInteger('count') || 10;
        await interaction.editReply('⏳ Reading the collection…');
        // No onProgress edits: fire-and-forget progress can land AFTER the
        // final embed and overwrite it with a stale "Queueing…" message.
        const fanRes = await music.playFan(client, voiceChannel, query.trim(), {
          requester: interaction.user,
          textChannel: interaction.channel,
          limit,
        });
        const { stageWarning } = require('../modules/music/stage');
        const fanWarn = voiceChannel.type === 13 ? stageWarning(client, interaction.guildId) : '';
        await interaction.editReply({ embeds: [fanCollectionEmbed(
          {
            fanName: `${fanRes.fan.name} (@${fanRes.fan.username})`,
            fanUrl: `https://bandcamp.com/${fanRes.fan.username}`,
            added: fanRes.added, failed: fanRes.failed, totalTracks: fanRes.totalTracks,
          },
          interaction.user,
        )], content: fanWarn || undefined });
        return;
      }
    } catch (e) {
      await interaction.editReply(`❌ Couldn't load the collection: ${String(e.message || e).slice(0, 300)}`);
      return;
    }

    try {
      const { addedTrackEmbed, playlistAddedEmbed, liveAddedEmbed } = require('../utils/embeds');
      const { stageWarning } = require('../modules/music/stage');
      const res = await music.play(client, voiceChannel, query, {
        requester: interaction.user,
        textChannel: interaction.channel,
      });
      // Stage warning read AFTER play (status set in ensurePlayer during join)
      const stageWarn = voiceChannel.type === 13 ? stageWarning(client, interaction.guildId) : '';
      const warnPayload = stageWarn ? { content: stageWarn } : {};

      if (res.kind === 'playlist') {
        const emb = playlistAddedEmbed(
          { title: res.playlist.title, count: res.playlist.count, first: res.track },
          interaction.user,
        );
        await interaction.editReply({ embeds: [emb], ...warnPayload });
        return;
      }
      // Direct stream/radio via /play (mp3 link): LIVE overlay instead of duration
      if (res.track.isLive) {
        const emb = liveAddedEmbed(
          { label: res.track.title, url: res.track.url, source: res.track.source },
          interaction.user,
        );
        await interaction.editReply({ embeds: [emb], ...warnPayload });
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
      await interaction.editReply({ embeds: [emb], ...warnPayload });
    } catch (e) {
      await interaction.editReply(`❌ Couldn't play: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
