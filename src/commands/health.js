const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const net = require('node:net');
const pkg = require('../../package.json');
const { config } = require('../config');

function ok(v) { return v ? '✅' : '❌'; }

function checkLavalink() {
  const { host, port } = config.music.lavalink;
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 5000 }, () => {
      sock.destroy();
      resolve(`✅ TCP ${host}:${port} reachable`);
    });
    sock.on('timeout', () => { sock.destroy(); resolve(`❌ TCP ${host}:${port} timeout`); });
    sock.on('error', (e) => resolve(`❌ TCP ${host}:${port} ${e.code || e.message}`));
  });
}

function checkEnv() {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'LAVALINK_HOST', 'LAVALINK_PORT', 'LAVALINK_PASSWORD'];
  const missing = required.filter(k => !process.env[k]);
  return missing.length ? `❌ missing: ${missing.join(', ')}` : '✅ required vars set';
}

function nodeInfo(client) {
  const lines = [];
  const nodes = client.music?.manager?.nodeManager?.nodes;
  if (!nodes?.size) return ['⚪ no nodes registered'];
  for (const node of nodes.values()) {
    const stats = node.stats || {};
    const players = stats.players ?? '-';
    const playing = stats.playingPlayers ?? '-';
    const ping = node.ping ?? node.latency ?? '-';
    lines.push(`${ok(node.connected)} **${node.id || node.options?.id || 'node'}** • ${node.options?.host}:${node.options?.port}`);
    lines.push(`ws ${ping}ms • players ${playing}/${players}`);
  }
  return lines;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Bot health: Lavalink node, players, config')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction, client) {
    const allowed = config.adminIds.includes(interaction.user.id)
      || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!allowed) {
      await interaction.reply({ content: '❌ Manage Server permission required.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [tcp] = await Promise.all([checkLavalink()]);
    const players = client.music?.manager?.players?.size ?? 0;
    const guild = interaction.guild;

    const e = new EmbedBuilder()
      .setColor(client.music?.available?.() ? 0x22c55e : 0xef4444)
      .setTitle(`🩺 Health: v${pkg.version}`)
      .setTimestamp()
      .setDescription(`**${guild?.name || 'DM'}** • uptime ${Math.floor(process.uptime() / 60)} min • Node ${process.version}`)
      .addFields(
        { name: '🔊 Lavalink', value: [...nodeInfo(client), tcp].join('\n').slice(0, 1000) || '-' },
        { name: '🎵 Players', value: `Active players: **${players}**`, inline: true },
        { name: '⚙️ Config', value: [checkEnv(), `Search: ${config.music.defaultSearchSource}`].join('\n').slice(0, 500) },
      )
      .setFooter({ text: `${config.botName} • Health` });

    await interaction.editReply({ embeds: [e] });
  },
};
