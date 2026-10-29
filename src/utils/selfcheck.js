// Voice preflight: effective permissions in THIS channel + limit + bot mute.
// Supports regular voice (2) and Stage channels (13) -- on stage Speak is not
// required; the bot requests the speaker role after joining.
const { PermissionFlagsBits } = require('discord.js');

const LABELS = new Map([
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.Connect, 'Connect'],
  [PermissionFlagsBits.Speak, 'Speak'],
]);

function labelOf(flag) {
  return LABELS.get(flag) || String(flag);
}

// Returns { ok, problems[], me, isStage }
async function checkVoice(client, voiceChannel) {
  const problems = [];
  const guild = voiceChannel.guild;
  const me = await guild.members.fetch(client.user.id).catch(() => null);
  if (!me) return { ok: false, problems: ['bot not in guild'], me: null, isStage: false };
  const isStage = voiceChannel.type === 13;
  const eff = voiceChannel.permissionsFor(me);
  const need = isStage
    ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
    : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
  for (const f of need) {
    if (!eff?.has(f)) problems.push(`missing "${labelOf(f)}" permission in channel ${voiceChannel.name}`);
  }
  if (voiceChannel.userLimit > 0 && voiceChannel.members.size >= voiceChannel.userLimit && !voiceChannel.members.has(me.id)) {
    problems.push(`channel ${voiceChannel.name} is full (limit ${voiceChannel.userLimit})`);
  }
  if (me.voice.serverMute) problems.push('bot is server-muted (Server Mute)');
  return { ok: problems.length === 0, problems, me, isStage };
}

module.exports = { checkVoice, labelOf };
