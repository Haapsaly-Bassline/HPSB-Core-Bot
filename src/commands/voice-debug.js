// /voice-debug: joins voice DIRECTLY bypassing discord-player and measures every step.
// Distinguishes "not playing" (locally) from "playing but not heard" (UDP/mute/perms).
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
    .setDescription('Voice diagnostics: direct connection + UDP/packet measurement (60 sec)')
    .addChannelOption(o => o.setName('channel').setDescription('Regular voice channel (not a stage)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!voiceChannel?.isVoiceBased?.() || voiceChannel.type === 13) {
      await interaction.editReply('❌ Diagnostics need a REGULAR voice channel (stages are always silent for listeners).'); return;
    }
    // kill previous debug session and engine queue so they don't interfere
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
      // Check if gateway voice events arrive at all (without them -- eternal signalling)
      const udpDebug = [];
      connection.on('debug', (m) => { if (udpDebug.length < 6) udpDebug.push(`${stamp()} dbg: ${String(m).slice(0, 160)}`); });
      lines.push(`Join: status=${connection.state.status}`);
      // wait for Ready -- includes UDP handshake. Timeout = network blocking UDP.
      await voip.entersState(connection, voip.VoiceConnectionStatus.Ready, 15000);
      lines.push(`Connection: ${connection.state.status} ✅ (UDP handshake passed, ${voiceChannel.name})`);

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
        ? 'Packets are flowing. LISTEN TO THE VOICE CHANNEL for 60 sec: radio audible — keep fixing the engine; silence with packets — UDP to Discord or mute.'
        : 'Packets are NOT flowing — the problem is local in transcoding (see /logs).');

      const timer = setTimeout(() => { try { connection.destroy(); } catch {} sessions.delete(interaction.guildId); }, 60000);
      sessions.set(interaction.guildId, { connection, player, timer });

      const e = new EmbedBuilder().setColor(0x0ea5e9).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800))
        .setFooter({ text: 'Disconnecting in 60 sec • Haapsaly Bassline' });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      const st = connection?.state?.status || 'no-connection';
      lines.push(`❌ FAIL: ${String(err.message || err).slice(0, 250)}`);
      lines.push(`State at failure: ${st}`);
      if (transitions.length) lines.push('Transitions:\n' + transitions.join('\n'));
      else lines.push('No transitions at all — the gateway sent no voice events (no session/token).');
      // Did our own voice-state reach Discord?
      try {
        const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
        lines.push(`Our voice state: ${me?.voice?.channelId ? `in channel ${me.voice.channelId}, session=${me.voice.sessionId ? 'present' : 'NONE'}` : 'not in a voice channel'}`);
      } catch {}
      if (/abort/i.test(String(err.message || err))) {
        lines.push('Abort while waiting for Ready = UDP handshake did NOT pass in 15s: the network is blocking voice UDP — a local bot will not be heard here, hosting/VPS is needed.');
      }
      try { connection?.destroy(); } catch {}
      const e = new EmbedBuilder().setColor(0xef4444).setTitle('🔬 Voice Debug').setTimestamp()
        .setDescription(lines.join('\n').slice(0, 3800));
      await interaction.editReply({ embeds: [e] }).catch(() => {});
    }
  },
};
