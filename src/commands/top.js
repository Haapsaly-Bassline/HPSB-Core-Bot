// /top: server overview + biggest roles by member count.
// Public showcase command (no mod gate), computed live from the API.
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');

// Pure part (unit-tested): top N roles by member count.
// members: [{ roles: [roleId] }], roleNames: Map(id -> name).
function computeTopRoles(members, roleNames, guildId, limit = 5) {
  const counts = new Map();
  for (const m of members || []) {
    for (const rid of m.roles || []) {
      if (rid === guildId) continue; // @everyone is everyone
      counts.set(rid, (counts.get(rid) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, n]) => ({ id, n, name: roleNames.get(id) || id }))
    .sort((a, b) => b.n - a.n)
    .slice(0, Math.max(1, limit));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Server overview + biggest roles'),
  async execute(interaction, client) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ Run this on the server, not in DM.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    try {
      const members = await guild.members.fetch().catch(() => guild.members.cache);
      const list = [...members.values()].filter((m) => !m.user.bot);
      const bots = [...members.values()].filter((m) => m.user.bot).length;
      const online = list.filter((m) => ['online', 'idle', 'dnd'].includes(m.presence?.status)).length;
      const names = new Map([...guild.roles.cache.values()].map((r) => [r.id, r.name]));
      const top = computeTopRoles(
        [...members.values()].map((m) => ({ roles: [...m.roles.cache.keys()] })),
        names, guild.id, 5,
      );
      const e = new EmbedBuilder()
        .setColor(0x7c3aed).setTitle(`🏆 ${guild.name}`).setTimestamp()
        .setThumbnail(guild.iconURL() || null)
        .addFields(
          { name: '👥 Members', value: `${members.size} (${list.length} users, ${bots} bots)`, inline: true },
          { name: '🟢 Online', value: `${online}`, inline: true },
          { name: '💎 Boosts', value: `${guild.premiumSubscriptionCount || 0} (lvl ${guild.premiumTier || 0})`, inline: true },
          {
            name: '🎭 Biggest roles',
            value: top.length ? top.map((r, i) => `\`${i + 1}.\` <@&${r.id}> — **${r.n}**`).join('\n') : '_no roles yet_',
          },
        )
        .setFooter({ text: 'Haapsaly Bassline • Top' });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await interaction.editReply({ content: `❌ Top failed: ${String(err.message || err).slice(0, 200)}` }).catch(() => {});
    }
  },
  computeTopRoles,
};
