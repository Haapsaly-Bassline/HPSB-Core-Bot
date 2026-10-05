const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, botMember, protectedTarget, modLog, replyError } = require('../utils/mod');
const store = require('../utils/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Remove a warn (latest or by number)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Whose').setRequired(true))
    .addIntegerOption(o => o.setName('number').setDescription('Warn number (latest by default)').setMinValue(1)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const member = await resolveMember(interaction, user);
    const blocked = member ? protectedTarget(member, interaction.member, await botMember(interaction)) : null;
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }
    const res = await store.exclusive(() => {
      const data = store.load();
      const list = data.warns[user.id] || [];
      const n = interaction.options.getInteger('number') || list.length;
      if (!list.length) return { empty: true };
      if (n < 1 || n > list.length) return { bad: true, total: list.length };
      const [rm] = list.splice(n - 1, 1);
      store.save(data);
      return { rm, n };
    });
    if (res.empty) { await interaction.reply({ content: `✅ ${user} has no warns.`, flags: MessageFlags.Ephemeral }); return; }
    if (res.bad) { await interaction.reply({ content: `❌ No warn #${interaction.options.getInteger('number')} (total ${res.total}).`, flags: MessageFlags.Ephemeral }); return; }
    const { modActionEmbed } = require('../utils/embeds');
    const emb = modActionEmbed('unwarn', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason: `Removed #${res.n}: ${res.rm.reason}` });
    await interaction.reply({ embeds: [emb] }).catch(async () => replyError(interaction, 'Unwarn recorded, but reply failed.'));
    await modLog(client, { embeds: [emb] });
  },
};
