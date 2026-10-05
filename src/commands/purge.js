const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, modLog, replyError } = require('../utils/mod');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete the last N messages (1–100)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('count').setDescription('How many').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Only this user').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const count = interaction.options.getInteger('count', true);
    const user = interaction.options.getUser('user');
    const audit = `Purge by ${interaction.user.tag}${user ? ` (filter: ${user.tag})` : ''}`;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return; // interaction already dead -- nothing to answer on
    }
    try {
      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter(m => m.author.id === user.id);
      messages = messages.first(Math.min(count, messages.size));
      // older than 14 days bulk delete won't take -- delete those one by one
      const old = Date.now() - 14 * 86400 * 1000;
      const fresh = [...messages.values()].filter(m => m.createdTimestamp > old);
      const stale = [...messages.values()].filter(m => m.createdTimestamp <= old);
      let deleted = 0;
      if (fresh.length) {
        const res = await interaction.channel.bulkDelete(fresh, true).catch(() => null);
        deleted += res ? res.size : 0;
      }
      for (const m of stale) {
        const ok = await m.delete({ reason: audit }).catch(() => false);
        if (ok !== false) deleted += 1;
      }
      const { modActionEmbed } = require('../utils/embeds');
      const emb = modActionEmbed('purge', { target: `<#${interaction.channelId}>`, mod: `${interaction.user}`, extra: `Deleted: ${deleted}${user ? ` • filter: ${user.tag}` : ''}` });
      await interaction.editReply({ embeds: [emb] });
      await modLog(client, { embeds: [emb] });
    } catch {
      await replyError(interaction, '❌ Could not delete (missing permissions?).');
    }
  },
};
