const { Events, EmbedBuilder } = require('discord.js');
const { modLog } = require('../utils/mod');
const { joinBeat } = require('../modules/honeypot/detector');
const { config } = require('../config');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      // Anti-raid: join spike -> newcomer muted + log note.
      // Clamped to Discord's 28-day timeout ceiling; the log tells the truth
      // (muted only when the API call actually succeeded).
      let raided = false;
      let muted = false;
      if (!member.user.bot && joinBeat(member, member.client) === 'raid') {
        raided = true;
        const hours = Math.min(Math.max(config.antiraid.hours, 1), 672);
        try {
          await member.timeout(hours * 3600 * 1000, 'Anti-raid: join spike');
          muted = true;
        } catch {}
      }
      const e = new EmbedBuilder().setColor(raided ? 0xff2020 : 0x22c55e).setTitle(raided ? '🚨 Join during raid' : '📥 New member').setTimestamp()
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'Who', value: `${member.user} (${member.id})` },
          { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
        );
      if (raided) e.addFields({ name: 'Action', value: muted ? `Mute (anti-raid)` : 'Mute FAILED -- check bot role/perms' });
      await modLog(member.client, { embeds: [e] });
    } catch {}
  },
};
