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
    .setDescription('Проверка разрешений бота (сервер + войс + мьюты)')
    .addChannelOption(o => o.setName('channel').setDescription('Войс для проверки (по умолч. твой)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const me = await interaction.guild.members.fetch(client.user.id).catch(() => null);
    if (!me) { await interaction.editReply('❌ Не вижу себя на сервере.'); return; }

    const gLines = WANT_GUILD.map(([n, f]) => `${me.permissions.has(f) ? '✅' : '❌'} ${n}`);
    const isAdmin = me.permissions.has(PermissionFlagsBits.Administrator);

    const voiceChannel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    let vLines = ['_войс не выбран_'];
    if (voiceChannel && voiceChannel.isVoiceBased?.()) {
      const eff = voiceChannel.permissionsFor(me);
      vLines = WANT_VOICE.map(([n, f]) => `${eff?.has(f) ? '✅' : '❌'} ${n}`);
      vLines.push(`Лимит: ${voiceChannel.userLimit || 'нет'} • Битрейт: ${(voiceChannel.bitrate || 0) / 1000}kbps`);
    }

    const vs = me.voice;
    const vState = [
      `${vs.serverMute ? '🔴' : '🟢'} Server Mute: ${vs.serverMute ? 'ВКЛЮЧЁН' : 'выкл'}`,
      `${vs.serverDeaf ? '🔴' : '🟢'} Server Deaf: ${vs.serverDeaf ? 'ВКЛЮЧЁН' : 'выкл'}`,
      `Канал бота: ${vs.channel ? `<#${vs.channel.id}>` : 'не в войсе'}`,
    ];

    const problems = [];
    if (!isAdmin) {
      if (!me.permissions.has(PermissionFlagsBits.Connect)) problems.push('Нет Connect на сервере');
      if (!me.permissions.has(PermissionFlagsBits.Speak)) problems.push('Нет Speak на сервере');
    }
    if (voiceChannel?.isVoiceBased?.()) {
      const eff = voiceChannel.permissionsFor(me);
      if (!isAdmin && eff && (!eff.has(PermissionFlagsBits.Connect) || !eff.has(PermissionFlagsBits.Speak))) {
        problems.push('В ЭТОМ войсе нет Connect/Speak (перезапись канала бьёт роль)');
      }
    }
    if (vs.serverMute) problems.push('Бот ЗАМЬЮЧЕН на сервере — звука не будет!');
    if (vs.serverDeaf) problems.push('Бот оглушён на сервере (deaf)');

    const e = new EmbedBuilder()
      .setColor(problems.length ? 0xef4444 : 0x22c55e)
      .setTitle(`🔐 Права: ${client.user.tag}`)
      .setDescription(isAdmin ? 'Administrator ✅ — права канала не важны.' : 'Без Administrator — смотрим детально:')
      .addFields(
        { name: 'Сервер', value: gLines.join('\n').slice(0, 1000) },
        { name: `Войс: ${voiceChannel?.name || '—'}`, value: vLines.join('\n').slice(0, 1000) },
        { name: 'Состояние', value: vState.join('\n') },
        { name: 'Вердикт', value: problems.length ? '❌ ' + problems.join('\n❌ ') : '✅ Всё чисто — дело не в правах.' },
      )
      .setTimestamp()
      .setFooter({ text: 'Haapsaly Bassline • Perms' });
    await interaction.editReply({ embeds: [e] });
  },
};
