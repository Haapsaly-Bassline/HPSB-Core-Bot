const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bandcamp-fan')
    .setDescription('Queue purchased items from a Bandcamp fan profile (albums as playlists)')
    .addStringOption(o => o.setName('url').setDescription('Link like https://bandcamp.com/username').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('How many releases to take (1-25, default 10)').setMinValue(1).setMaxValue(25).setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel (defaults to yours)').setRequired(false)),
  async execute(interaction, client) {
    const url = interaction.options.getString('url', true);
    const count = interaction.options.getInteger('count') || 10;
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;
    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.editReply('❌ Join a voice channel or stage (or specify one via the channel option).');
      return;
    }

    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.editReply(`❌ Can't join that voice channel:\n❌ ${pre.problems.join('\n❌ ')}`);
        return;
      }
    } catch {}

    try {
      const { fanCollectionEmbed } = require('../utils/embeds');
      await interaction.editReply('⏳ Reading the collection…');
      const res = await music.playFan(client, voiceChannel, url, {
        requester: interaction.user,
        textChannel: interaction.channel,
        limit: count,
        onProgress: (done, total) => {
          interaction.editReply(`⏳ Queueing: ${done}/${total}…`).catch(() => {});
        },
      });
      const emb = fanCollectionEmbed(
        {
          fanName: `${res.fan.name} (@${res.fan.username})`,
          fanUrl: `https://bandcamp.com/${res.fan.username}`,
          added: res.added, failed: res.failed, totalTracks: res.totalTracks,
        },
        interaction.user,
      );
      let warnPayload = {};
      try {
        if (voiceChannel.type === 13) {
          const { stageWarning } = require('../modules/music/stage');
          const w = stageWarning(client, interaction.guildId);
          if (w) warnPayload = { content: w };
        }
      } catch {}
      await interaction.editReply({ embeds: [emb], ...warnPayload });
    } catch (e) {
      await interaction.editReply(`❌ Couldn't load the collection: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
