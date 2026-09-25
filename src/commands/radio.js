const { SlashCommandBuilder } = require('discord.js');
const { QueryType } = require('discord-player');

const STATIONS = {
  hpsb: { name: 'Haapsaly Bassline', url: 'https://azura.hpsbassline.club/listen/haapsaly_bassline/radio.mp3' },
  predictor: { name: 'Hardcore Predictor FM', url: 'https://azura.hpsbassline.club/listen/hardcore_predictorfm/radio.mp3' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Включить радио HPSB')
    .addStringOption(o => o.setName('station').setDescription('Станция').setRequired(false)
      .addChoices({ name: 'Haapsaly Bassline', value: 'hpsb' }, { name: 'Hardcore Predictor FM', value: 'predictor' }))
    .addStringOption(o => o.setName('url').setDescription('Свой поток (mp3/aac, перебивает станцию)').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Войс-канал (по умолчанию твой)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply();
    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
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
    const custom = (interaction.options.getString('url') || '').trim();
    const key = interaction.options.getString('station') || 'hpsb';
    const st = STATIONS[key] || STATIONS.hpsb;
    const url = custom || st.url;
    const label = custom || st.name;
    // Своя ссылка на обычный трек/видео — пускаем через AUTO, потоки — ARBITRARY
    const isStream = !custom || /\.(mp3|ogg|oga|wav|m4a|flac|aac|opus|m3u8|pls)(\?|$)|azura\.hpsbassline\.club\/listen|\/listen\//i.test(custom);
    try {
      await client.player.play(voiceChannel, url, {
        nodeOptions: { metadata: { channel: interaction.channel, requester: interaction.user, radioLabel: label } },
        requestedBy: interaction.user,
        // Прямой эфир — только ARBITRARY: через AUTO резолвер его не берёт
        searchEngine: isStream ? QueryType.ARBITRARY : QueryType.AUTO,
      });
      await interaction.editReply(`📻 Включено: **${label}**`);
    } catch (e) {
      await interaction.editReply(`❌ Не смог включить радио: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
