const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Инфо о пользователе')
    .addUserOption(o => o.setName('user').setDescription('Кого (по умолч. ты)').setRequired(false)),
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
        { name: 'Аккаунт создан', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Бот', value: user.bot ? 'Да' : 'Нет', inline: true },
      )
      .setTimestamp();
    if (member) {
      e.addFields(
        { name: 'На сервере с', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—', inline: true },
        { name: 'Таймаут', value: member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
          ? `до <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>` : 'нет', inline: true },
        { name: `Роли (${member.roles.cache.size - 1})`, value: roles.slice(0, 1000) || '—' },
      );
    }
    const warns = (require('../utils/store').load().warns[user.id] || []).length;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      e.setFooter({ text: `Варнов: ${warns} • Haapsaly Bassline` });
    } else {
      e.setFooter({ text: 'Haapsaly Bassline' });
    }
    await interaction.reply({ embeds: [e] });
  },
};
