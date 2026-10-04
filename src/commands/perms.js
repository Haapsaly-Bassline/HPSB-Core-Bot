const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const WANT_GUILD = [
  ['Administrator', PermissionFlagsBits.Administrator],
  ['Manage Channels', PermissionFlagsBits.ManageChannels],
  ['Manage Messages', PermissionFlagsBits.ManageMessages],
  ['Manage Roles', PermissionFlagsBits.ManageRoles],
  ['Moderate Members', PermissionFlagsBits.ModerateMembers],
  ['Kick', PermissionFlagsBits.KickMembers],
  ['Ban', PermissionFlagsBits.BanMembers],
  ['Send Messages', PermissionFlagsBits.SendMessages],
  ['Embed Links', PermissionFlagsBits.EmbedLinks],
  ['Read History', PermissionFlagsBits.ReadMessageHistory],
  ['Connect (global)', PermissionFlagsBits.Connect],
  ['Speak (global)', PermissionFlagsBits.Speak],
];

const WANT_VOICE = [
  ['View Channel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perms')
    .setDescription('Check the bot permissions (server + voice + mutes)')
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel to check (your current one by default)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
    if (!me) { await interaction.editReply('❌ I cannot see myself on the server.'); return; }

    const gLines = WANT_GUILD.map(([n, f]) => `${me.permissions.has(f) ? '✅' : '❌'} ${n}`);
    const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);

    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    let vLines = ['_no voice selected_'];
    if (voiceChannel && voiceChannel.isVoiceBased?.()) {
      const eff = voiceChannel.permissionsFor(me);
      vLines = WANT_VOICE.map(([n, f]) => `${eff?.has(f) ? '✅' : '❌'} ${n}`);
      vLines.push(`Limit: ${voiceChannel.userLimit || 'none'} • Bitrate: ${(voiceChannel.bitrate || 0) / 1000}kbps`);
    }

    const vs = me.voice;
    const vState = [
      `${vs.serverMute ? '🔴' : '🟢'} Server Mute: ${vs.serverMute ? 'ON' : 'off'}`,
      `${vs.serverDeaf ? '🔴' : '🟢'} Server Deaf: ${vs.serverDeaf ? 'ON' : 'off'}`,
      `Bot channel: ${vs.channel ? `<#${vs.channel.id}>` : 'not in voice'}`,
    ];

    // Which voice channels bot can see at all (View/Connect/Speak)
    const voiceList = interaction.guild.channels.cache
      .filter(c => c.isVoiceBased?.())
      .map(c => {
        const e = c.permissionsFor(me);
        const mark = !e?.has(PermissionFlagsBits.ViewChannel) ? '❌'
          : (!e.has(PermissionFlagsBits.Connect) || (!e.has(PermissionFlagsBits.Speak) && c.type !== 13)) ? '🔶' : '✅';
        const kind = c.type === 13 ? '🎭 stage' : '🔊';
        return `${mark} ${kind} ${c.name}`;
      });

    const problems = [];
    if (!isAdmin) {
      if (!me.permissions.has(PermissionFlagsBits.Connect)) problems.push('No Connect on the server');
      if (!me.permissions.has(PermissionFlagsBits.Speak)) problems.push('No Speak on the server');
    }
    if (voiceChannel?.isVoiceBased?.()) {
      const eff = voiceChannel.permissionsFor(me);
      if (!isAdmin && eff && (!eff.has(PermissionFlagsBits.Connect) || !eff.has(PermissionFlagsBits.Speak))) {
        problems.push('No Connect/Speak in THIS voice channel (channel overwrite overrides the role)');
      }
    }
    if (vs.serverMute) problems.push('Bot is MUTED on the server — no audio!');
    if (vs.serverDeaf) problems.push('Bot is deafened on the server (deaf)');

    const e = new EmbedBuilder()
      .setColor(problems.length ? 0xef4444 : 0x22c55e)
      .setTitle(`🔐 Permissions: ${client.user.tag}`)
      .setDescription(isAdmin ? 'Administrator ✅ — channel permissions do not matter.' : 'No Administrator — checking in detail:')
      .addFields(
        { name: 'Server', value: gLines.join('\n').slice(0, 1000) },
        { name: `Voice: ${voiceChannel?.name || '—'}`, value: vLines.join('\n').slice(0, 1000) },
        { name: 'State', value: vState.join('\n') },
        { name: 'All voice channels (❌=no access, 🔶=visible but no connect/speak)', value: (voiceList.join('\n') || '—').slice(0, 1000) },
        { name: 'Verdict', value: problems.length ? '❌ ' + problems.join('\n❌ ') : '✅ All clear — not a permission issue.' },
      )
      .setTimestamp()
      .setFooter({ text: 'Haapsaly Bassline • Perms' });
    await interaction.editReply({ embeds: [e] });
  },
};
