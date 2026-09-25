// /voice-debug: идёт в войс НАПРЯМУЮ мимо discord-player и меряет каждый этап.
// Отличает «не играет» (локально) от «играет, но не слышно» (UDP/мьют/права).
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const voip = require('discord-voip');
const prism = require('prism-media');
const axios = require('axios');

const URL = 'https://azura.hpsbassline.club/listen/haapsaly_bassline/radio.mp3';
const sessions = new Map(); // guildId -> { connection, player, timer }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice-debug')
    .setDescription('Диагностика голоса: прямое подключение + замер UDP/пакетов (60 сек)')
    .addChannelOption(o => o.setName('channel').setDescription('Войс-канал').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!voiceChannel || voiceChannel.type !== 2) {
      await interaction.editReply('❌ Зайди в войс.'); return;
    }
    // убиваем прошлую debug-сессию и очередь плеера, чтобы не мешали
    try { sessions.get(interaction.guildId)?.connection.destroy(); } catch {}
    sessions.delete(interaction.guildId);
    try { client.player.nodes.get(interaction.guildId)?.delete(); } catch {}

    const lines = [];
    try {
      lines.push(`DepReport opus/ffmpeg: ${summarizeDeps()}`);
      const connection = voip.joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      // ждём Ready — сюда входит UDP-handshake. Таймаут = сеть режет UDP.
      await voip.entersState(connection, voip.VoiceConnectionStatus.Ready, 15000);
      lines.push(`Connection: ${connection.state.status} ✅ (UDP handshake прошёл)`);

      const { data: httpStream } = await axios.get(URL, { responseType: 'stream', timeout: 15000 });
      const ff = new prism.FFmpeg({ args: ['-analyzeduration', '0', '-loglevel', 'error', '-i', URL, '-f', 's16le', '-ar', '48000', '-ac', '2'] });
      const opus = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
      let packets = 0;
      opus.on('data', () => { packets++; });
      const resource = voip.createAudioResource(ff.pipe(opus), { inputType: voip.StreamType.Raw });
      const player = voip.createAudioPlayer({ behaviors: { noSubscriber: voip.NoSubscriberBehavior.Play } });
      player.on('error', () => {});
      connection.subscribe(player);
      player.play(resource);
      await sleep(12000);
      lines.push(`Player: ${player.state.status}, playbackDuration=${player.state.playbackDuration}ms, opusPackets=${packets}`);
      lines.push(packets > 100
        ? 'Пакеты идут. СЛУШАЙ ВОЙС 60 сек: если слышно радио — виноват discord-player; если тишина — UDP/мьют.'
        : 'Пакеты НЕ идут — проблема локально в транскоде (смотри /logs).');

      const timer = setTimeout(() => { try { connection.destroy(); } catch {} sessions.delete(interaction.guildId); }, 60000);
      sessions.set(interaction.guildId, { connection, player, timer });

      const e = new EmbedBuilder().setColor(0x0ea5e9).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800))
        .setFooter({ text: 'Отключаюсь через 60 сек • Haapsaly Bassline' });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      lines.push(`❌ FAIL: ${String(err.message || err).slice(0, 300)}`);
      if (/timeout|timed out|Ready/i.test(String(err.message || err))) {
        lines.push('UDP-handshake НЕ прошёл — сеть режет голосовой UDP. Локальный бот тут звучать не будет, нужен хостинг/VPS.');
      }
      const e = new EmbedBuilder().setColor(0xef4444).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800));
      await interaction.editReply({ embeds: [e] }).catch(() => {});
    }
  },
};

function summarizeDeps() {
  try {
    const r = voip.generateDependencyReport();
    const compact = String(r).replace(/\s+/g, ' ');
    const opus = /opus[^,]*?(found|not found|opusscript|@discordjs\/opus)[^,]*/i.exec(compact);
    const ff = /ffmpeg[^,]*?(found|not found)[^,]*/i.exec(compact);
    return `${opus ? opus[0].slice(0, 60) : 'opus?'} | ${ff ? ff[0].slice(0, 60) : 'ffmpeg?'}`;
  } catch { return 'n/a'; }
}
