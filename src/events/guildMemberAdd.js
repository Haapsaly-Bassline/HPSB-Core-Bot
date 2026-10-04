const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');
const { joinBeat } = require('../modules/honeypot/detector');
const { config } = require('../config');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      // Anti-raid: join spike -> newcomer muted + log note
      let raided = false;
      if (!member.user.bot && joinBeat(member, member.client) === 'raid') {
        raided = true;
        await member.timeout(Math.max(config.antiraid.hours, 1) * 3600 * 1000, 'Anti-raid: join spike').catch(() => {});
      }
      const e = new EmbedBuilder().setColor(raided ? 0xff2020 : 0x22c55e).setTitle(raided ? '🚨 Join during raid' : '📥 New member').setTimestamp()
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'Who', value: `${member.user} (${member.id})` },
          { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
        );
      if (raided) e.addFields({ name: 'Action', value: `Mute ${config.antiraid.hours}h (anti-raid)` });
      await modLog(member.client, { embeds: [e] });
    } catch {}
  },
};
