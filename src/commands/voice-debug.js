// /voice-debug: идёт в войс НАПРЯМУЮ мимо discord-player и меряет каждый этап.
// Отличает «не играет» (локально) от «играет, но не слышно» (UDP/мьют/права).
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const voip = require('@discordjs/voice');
const prism = require('prism-media');
const axios = require('axios');

const URL = 'https://azura.hpsbassline.club/listen/haapsaly_bassline/radio.mp3';
const sessions = new Map(); // guildId -> { connection, player, timer }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function summarizeDeps() {
  const out = [];
  try { out.push('opus@' + require('@discordjs/opus/package.json').version); }
  catch { out.push('opus=missing'); }
  try {
    const bin = require('ffmpeg-static');
    out.push('ffmpeg=' + (bin && require('node:fs').existsSync(bin) ? 'ok' : 'missing'));
  } catch { out.push('ffmpeg=missing'); }
  return out.join(' | ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice-debug')
    .setDescription('Диагностика голоса: прямое подключение + замер UDP/пакетов (60 сек)')
    .addChannelOption(o => o.setName('channel').setDescription('Обычный войс (не сцена)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!voiceChannel?.isVoiceBased?.() || voiceChannel.type === 13) {
      await interaction.editReply('❌ Для диагностики нужен ОБЫЧНЫЙ войс (сцены всегда молчат для слушателей).'); return;
    }
    // убиваем прошлую debug-сессию и очередь движка, чтобы не мешали
    try { sessions.get(interaction.guildId)?.connection.destroy(); } catch {}
    sessions.delete(interaction.guildId);
    try { await client.music?.stop(interaction.guildId); } catch {}

    const lines = [`Deps: ${summarizeDeps()}`];
    let connection = null;
    const transitions = [];
    const t0 = Date.now();
    const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
    try {
      connection = voip.joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      connection.on('stateChange', (oldS, newS) => {
        transitions.push(`${stamp()} ${oldS.status} -> ${newS.status}`);
      });
      // Смотрим, прилетают ли вообще gateway-события голоса (без них — вечный signalling)
      const udpDebug = [];
      connection.on('debug', (m) => { if (udpDebug.length < 6) udpDebug.push(`${stamp()} dbg: ${String(m).slice(0, 160)}`); });
      lines.push(`Join: status=${connection.state.status}`);
      // ждём Ready — сюда входит UDP-handshake. Таймаут = сеть режет UDP.
      await voip.entersState(connection, voip.VoiceConnectionStatus.Ready, 15000);
      lines.push(`Connection: ${connection.state.status} ✅ (UDP handshake прошёл, ${voiceChannel.name})`);

      const { data: httpStream } = await axios.get(URL, { responseType: 'stream', timeout: 15000 });
      const ff = new prism.FFmpeg({ args: ['-analyzeduration', '0', '-loglevel', 'error', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-fflags', '+genpts', '-i', URL, '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2'] });
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
        ? 'Пакеты идут. СЛУШАЙ ВОЙС 60 сек: слышно радио — движок чиним дальше; тишина при пакетах — UDP до Discord или мьют.'
        : 'Пакеты НЕ идут — проблема локально в транскоде (смотри /logs).');

      const timer = setTimeout(() => { try { connection.destroy(); } catch {} sessions.delete(interaction.guildId); }, 60000);
      sessions.set(interaction.guildId, { connection, player, timer });

      const e = new EmbedBuilder().setColor(0x0ea5e9).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800))
        .setFooter({ text: 'Отключаюсь через 60 сек • Haapsaly Bassline' });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      const st = connection?.state?.status || 'no-connection';
      lines.push(`❌ FAIL: ${String(err.message || err).slice(0, 250)}`);
      lines.push(`Состояние на момент падения: ${st}`);
      if (transitions.length) lines.push('Переходы:\n' + transitions.join('\n'));
      else lines.push('Переходов не было вообще — gateway не отдал voice-события (нет session/token).');
      // Дошёл ли наш собственный voice-state до Discord?
      try {
        const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
        lines.push(`Наш voice-state: ${me?.voice?.channelId ? `в канале ${me.voice.channelId}, session=${me.voice.sessionId ? 'есть' : 'НЕТ'}` : 'не в войсе'}`);
      } catch {}
      if (/abort/i.test(String(err.message || err))) {
        lines.push('Abort на ожидании Ready = UDP-handshake НЕ прошёл за 15с: сеть режет голосовой UDP — локальный бот тут звучать не будет, нужен хостинг/VPS.');
      }
      try { connection?.destroy(); } catch {}
      const e = new EmbedBuilder().setColor(0xef4444).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800));
      await interaction.editReply({ embeds: [e] }).catch(() => {});
    }
  },
};
