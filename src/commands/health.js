const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const axios = require('axios');
const pkg = require('../../package.json');
const { config } = require('../config');
const { requireMod } = require('../utils/mod');

function ok(v) { return v ? '✅' : '❌'; }

async function checkChannels(client) {
  const ids = {
    'modcall-panel': config.modcall.panelChannelId,
    'modcall-staff': config.modcall.staffChannelId,
    'honeypot': config.honeypot.trapChannelId,
    'honeypot-log': config.honeypot.logChannelId || config.logChannelId,
    'releases': config.hpsb.releases.channelId,
    'events': config.hpsb.events.channelId,
    'posts': config.hpsb.posts.channelId,
  };
  const { channelIdsFor, TYPES } = require('../modules/stats/counter');
  for (const t of TYPES) {
    const idsArr = channelIdsFor(t);
    if (idsArr.length) ids[`stats:${t}`] = idsArr[0];
  }
  const out = [];
  await Promise.all(Object.entries(ids).map(async ([name, id]) => {
    if (!id) { out.push(`⚪ ${name}: not set`); return; }
    const ch = await client.channels.fetch(id).catch(() => null);
    out.push(`${ok(!!ch)} ${name}: ${ch ? `#${ch.name}` : `\`${id}\` NOT FOUND`}`);
  }));
  return out.sort();
}

async function checkApis() {
  const urls = {
    'releases': config.hpsb.releases.feedUrl,
    'events': config.hpsb.events.feedUrl,
    'posts': config.hpsb.posts.apiUrl,
  };
  const out = [];
  await Promise.all(Object.entries(urls).map(async ([name, url]) => {
    if (!url) { out.push(`⚪ ${name}: URL empty`); return; }
    try {
      const r = await axios.get(url, { timeout: 8000, validateStatus: () => true, headers: { 'User-Agent': 'HPSB-Core-Bot/1.0' } });
      const len = typeof r.data === 'string' ? r.data.length : JSON.stringify(r.data).length;
      out.push(`${r.status === 200 && len > 100 ? '✅' : '❌'} ${name}: HTTP ${r.status} (${len}B)`);
    } catch (e) { out.push(`❌ ${name}: ${e.code || e.message}`); }
  }));
  return out.sort();
}

function checkVoice() {
  const out = [];
  try { require('@discordjs/opus'); out.push('✅ opus'); }
  catch { out.push('❌ opus MISSING'); }
  try {
    const bin = require('ffmpeg-static');
    out.push(bin && fs.existsSync(bin) ? '✅ ffmpeg' : '❌ ffmpeg MISSING');
  } catch { out.push('❌ ffmpeg MISSING'); }
  return out;
}

function checkLavalink() {
  return new Promise((resolve) => {
    if (config.music.engine !== 'lavalink') { resolve(['⚪ lavalink: off (legacy removed -- set MUSIC_ENGINE=lavalink)']); return; }
    const { host, port } = config.music.lavalink;
    const sock = net.connect({ host, port, timeout: 5000 }, () => {
      sock.destroy();
      resolve([`✅ lavalink: ${host}:${port} reachable`]);
    });
    sock.on('timeout', () => { sock.destroy(); resolve([`❌ lavalink: ${host}:${port} timeout`]); });
    sock.on('error', (e) => resolve([`❌ lavalink: ${e.code || e.message}`]));
  });
}

function checkEnv() {
  try {
    const ex = fs.readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8');
    const keys = [...ex.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]);
    const missing = keys.filter(k => !process.env[k]);
    // optional ones don't count as problems
    // Empty ID = feature disabled (counter/category/mapping not configured) -- valid state, not error.
    const optional = new Set(['WEBHOOK_SECRET', 'WEBHOOK_NEWS_CHANNEL_ID', 'SITE_API_URL', 'SITE_API_KEY',
      'SITE_NEWS_CHANNEL_ID', 'HONEYPOT_BANNER_URL', 'YT_API_KEY', 'IG_GRAPH_TOKEN', 'IG_BUSINESS_ID',
      'IG_CSRFTOKEN', 'IG_DID', 'IG_SESSIONID', 'AUTOMOD_BADWORDS', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET',
      'DISCORD_CLIENT_SECRET', 'LOG_CHANNEL_ID', 'TIKTOK_MAP', 'INSTAGRAM_MAP', 'SESSION_SECRET',
      'PRIV_CATEGORY_ID', 'STATS_MEMBERS_CHANNEL_ID', 'STATS_HUMANS_CHANNEL_ID', 'STATS_BOTS_CHANNEL_ID',
      'STATS_ROLES_CHANNEL_ID', 'STATS_CHANNELS_CHANNEL_ID', 'STATS_ROLE_CHANNEL_ID', 'STATS_ROLE_ID',
      'STATS_ONLINE_CHANNEL_ID', 'STATS_OFFLINE_CHANNEL_ID', 'STATS_BOOSTS_CHANNEL_ID']);
    const need = missing.filter(k => !optional.has(k));
    if (!need.length) return ['✅ .env complete'];
    return [`❌ .env missing: ${need.join(', ')}`];
  } catch { return ['⚪ .env.example not readable']; }
}

function checkStore() {
  try {
    const dir = path.join(__dirname, '..', '..', 'data');
    fs.accessSync(dir, fs.constants.W_OK);
    require('../utils/store').load();
    return ['✅ store (read/write)'];
  } catch (e) { return [`❌ store: ${e.message}`]; }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Bot health check: subsystems, channels, API, .env')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [channels, apis, lavalink] = await Promise.all([
      checkChannels(client), checkApis(), checkLavalink(),
    ]);
    const guild = interaction.guild;
    const e = new EmbedBuilder()
      .setColor(0x7c3aed).setTitle(`🩺 Health: v${pkg.version}`).setTimestamp()
      .setDescription(`**${guild.name}** • uptime ${Math.floor(process.uptime() / 60)} min • Node ${process.version}`)
      .addFields(
        { name: '📡 Channels', value: channels.join('\n').slice(0, 1000) || '-' },
        { name: '🌐 API', value: apis.join('\n').slice(0, 500) || '-' },
        { name: '🔊 Voice & Music', value: [...checkVoice(), ...lavalink].join('\n') },
        { name: '⚙️ Config & Store', value: [...checkEnv(), ...checkStore()].join('\n').slice(0, 500) },
      )
      .setFooter({ text: 'Haapsaly Bassline • Health' });
    await interaction.editReply({ embeds: [e] });
  },
};
