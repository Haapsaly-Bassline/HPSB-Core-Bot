const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');
const { joinBeat } = require('../modules/honeypot/detector');
const { config } = require('../config');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      // Anti-raid: всплеск заходов — новичка в мут + пометка в логе
      let raided = false;
      if (!member.user.bot && joinBeat(member, member.client) === 'raid') {
        raided = true;
        await member.timeout(Math.max(config.antiraid.hours, 1) * 3600 * 1000, 'Anti-raid: всплеск заходов').catch(() => {});
      }
      const e = new EmbedBuilder().setColor(raided ? 0xff2020 : 0x22c55e).setTitle(raided ? '🚨 Вход во время рейда' : '📥 Новый участник').setTimestamp()
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'Кто', value: `${member.user} (${member.id})` },
          { name: 'Аккаунт создан', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
        );
      if (raided) e.addFields({ name: 'Действие', value: `Мут на ${config.antiraid.hours}ч (anti-raid)` });
      await modLog(member.client, { embeds: [e] });
    } catch {}
  },
};
