const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requirePower, resolveMember, botMember, protectedTarget, modLog, replyError } = require('../utils/mod');

const MAX_MS = 28 * 86400 * 1000; // Discord timeout cap
const MIN_MS = 10 * 1000;

function parseDur(raw) {
  if (!raw) return 60 * 60 * 1000;
  const m = String(raw).trim().match(/^(\d+)\s*([smhdw])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!n || n <= 0) return null;
  const mult = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 86400 * 1000, w: 7 * 86400 * 1000 }[(m[2] || 'm').toLowerCase()];
  return Math.min(Math.max(n * mult, MIN_MS), MAX_MS);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute (timeout): 10m, 2h, 1d, 1w. Bare number = minutes. No duration - 1h')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration: 10m / 2h / 1d / 1w (min 10s)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  async execute(interaction, client) {
    if (!await requirePower(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members')) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason';
    const ms = parseDur(interaction.options.getString('duration'));
    if (!ms) { await interaction.reply({ content: '❌ Time format: `10m`, `2h`, `1d`, `1w` (min 10s, bare number = minutes).', flags: MessageFlags.Ephemeral }); return; }
    const member = await resolveMember(interaction, user);
    const blocked = member ? protectedTarget(member, interaction.member, await botMember(interaction)) : 'User is not on the server.';
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
    try {
      await member.timeout(ms, `Mute by ${interaction.user.tag}: ${reason}`);
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('mute', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason, extra: `Duration: ${interaction.options.getString('duration') || '1h'}` });
      await interaction.reply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await replyError(interaction, '❌ Could not mute (bot role too low?).');
    }
  },
};
