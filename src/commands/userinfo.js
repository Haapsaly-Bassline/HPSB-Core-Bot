const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('User info')
    .addUserOption(o => o.setName('user').setDescription('Who (you by default)').setRequired(false)),
  async execute(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const roles = member ? [...member.roles.cache.values()].filter(r => r.name !== '@everyone').map(r => r.toString()).slice(0, 20).join(' ') : '—';
    const e = new EmbedBuilder()
      .setColor(member?.displayHexColor || 0x7c3aed)
      .setTitle(`👤 ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Bot', value: user.bot ? 'Yes' : 'No', inline: true },
      )
      .setTimestamp();
    if (member) {
      e.addFields(
        { name: 'On server since', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—', inline: true },
        { name: 'Timeout', value: member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
          ? `until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>` : 'none', inline: true },
        { name: `Roles (${member.roles.cache.size - 1})`, value: roles.slice(0, 1000) || '—' },
      );
    }
    const warns = (require('../utils/store').load().warns[user.id] || []).length;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      e.setFooter({ text: `Warns: ${warns} • Haapsaly Bassline` });
    } else {
      e.setFooter({ text: 'Haapsaly Bassline' });
    }
    await interaction.reply({ embeds: [e] });
  },
};
