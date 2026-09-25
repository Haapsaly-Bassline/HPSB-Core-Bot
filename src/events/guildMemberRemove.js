const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    try {
      const roles = [...(member.roles?.cache?.values() || [])].filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 10).join(', ');
      const e = new EmbedBuilder().setColor(0x6b7280).setTitle('📤 Участник ушёл').setTimestamp()
        .addFields(
          { name: 'Кто', value: `${member.user?.tag || '?'} (${member.id})` },
          { name: 'Был на сервере', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—' },
          { name: 'Роли', value: roles || '—' },
        );
      await modLog(member.client, { embeds: [e] });
    } catch {}
  },
};
