const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

const STATIONS = {
  hpsb: { name: 'Haapsaly Bassline', url: 'https://azura.hpsbassline.club/listen/haapsaly_bassline/radio.mp3' },
  predictor: { name: 'Hardcore Predictor FM', url: 'https://azura.hpsbassline.club/listen/hardcore_predictorfm/radio.mp3' },
};

const DIRECT_RE = /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen|\/listen\//i;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Play HPSB radio')
    .addStringOption(o => o.setName('station').setDescription('Station').setRequired(false)
      .addChoices({ name: 'Haapsaly Bassline', value: 'hpsb' }, { name: 'Hardcore Predictor FM', value: 'predictor' }))
    .addStringOption(o => o.setName('url').setDescription('Custom stream (mp3/aac, overrides the station)').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel (defaults to yours)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply();
    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
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

    const custom = (interaction.options.getString('url') || '').trim();
    const key = interaction.options.getString('station') || 'hpsb';
    const st = STATIONS[key] || STATIONS.hpsb;
    const url = custom || st.url;
    const label = custom || st.name;
    try {
      const { liveAddedEmbed } = require('../utils/embeds');
      const { stageWarning } = require('../modules/music/stage');
      await music.play(client, voiceChannel, url, {
        requester: interaction.user,
        textChannel: interaction.channel,
        radioLabel: label,
      });
      const warnPayload = (() => {
        if (voiceChannel.type !== 13) return {};
        const w = stageWarning(client, interaction.guildId);
        return w ? { content: w } : {};
      })();
      await interaction.editReply({ embeds: [liveAddedEmbed({ label, url, source: 'http' }, interaction.user)], ...warnPayload });
    } catch (e) {
      await interaction.editReply(`❌ Couldn't play the radio: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
