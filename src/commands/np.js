const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

const STATIONS = {
  hpsb: 'haapsaly_bassline',
  predictor: 'hardcore_predictorfm',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('np')
    .setDescription('Что сейчас в эфире радио HPSB')
    .addStringOption(o => o.setName('station').setDescription('Станция').setRequired(false)
      .addChoices({ name: 'Haapsaly Bassline', value: 'hpsb' }, { name: 'Hardcore Predictor FM', value: 'predictor' })),
  async execute(interaction) {
    await interaction.deferReply();
    const key = interaction.options.getString('station') || 'hpsb';
    try {
      const { data } = await axios.get('https://azura.hpsbassline.club/api/nowplaying', { timeout: 15000 });
      const st = (Array.isArray(data) ? data : []).find(s => s.station?.shortcode === STATIONS[key]);
      if (!st) { await interaction.editReply('❌ Станция не найдена.'); return; }
      const np = st.now_playing?.song || {};
      const live = st.live?.is_live ? `🔴 LIVE: ${st.live.streamer_name || ''}` : null;
      const e = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`📻 ${st.station.name} — сейчас в эфире`)
        .setURL(st.station.public_player_url || undefined)
        .setDescription(`**${np.artist || ''} — ${np.title || '...'}**${live ? `\n${live}` : ''}`.slice(0, 2000))
        .setTimestamp();
      if (np.art) e.setThumbnail(np.art);
      const rows = [];
      if (np.album) rows.push(`Альбом: ${np.album}`.slice(0, 200));
      rows.push(`Слушателей: ${st.listeners?.current ?? '—'}`);
      if (st.playing_next?.song) rows.push(`Дальше: ${st.playing_next.song.artist || ''} — ${st.playing_next.song.title || ''}`.slice(0, 250));
      e.addFields({ name: 'Эфир', value: rows.join('\n').slice(0, 900) });
      e.setFooter({ text: 'Haapsaly Bassline • Radio' });
      await interaction.editReply({ embeds: [e] });
    } catch {
      await interaction.editReply({ content: '❌ Радио недоступно.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
