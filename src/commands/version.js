const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../../package.json');
const { config } = require('../config');

function uptimeStr(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// Date of freshest code file -- marker without manual bumps: any change visible
function codeDate() {
  let max = 0;
  const touch = (p) => { try { const t = fs.statSync(p).mtimeMs; if (t > max) max = t; } catch {} };
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else touch(p);
    }
  };
  const root = path.join(__dirname, '..', '..');
  walk(path.join(root, 'src'));
  touch(path.join(root, 'package.json'));
  return max ? new Date(max).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '?';
}

module.exports = {
  data: new SlashCommandBuilder().setName('version').setDescription('Bot version and environment'),
  async execute(interaction, client) {
    let now = 'empty';
    try {
      const v = require('../modules/music/service').queueView(client, interaction.guildId);
      if (v?.current) now = v.current.title;
    } catch {}
    const e = new EmbedBuilder()
      .setColor(0x7c3aed).setTitle(`🤖 HPSB Core Bot v${pkg.version}`).setTimestamp()
      .addFields(
        { name: 'Build', value: `v${pkg.version}`, inline: true },
        { name: 'Code from', value: codeDate(), inline: true },
        { name: 'Node', value: process.version, inline: true },
        { name: 'Uptime', value: uptimeStr(process.uptime() * 1000), inline: true },
        { name: 'Music engine', value: `lavalink${client.lavalink ? ' (connected)' : ' (flag on, node unavailable)'}`, inline: false },
        { name: 'Queue now', value: now, inline: false },
      )
      .setFooter({ text: 'Haapsaly Bassline' });
    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
