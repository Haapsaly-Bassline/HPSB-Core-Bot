const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, botMember, protectedTarget, modLog, replyError } = require('../utils/mod');
const store = require('../utils/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Who').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'No reason';
    const member = await resolveMember(interaction, user);
    const blocked = member ? protectedTarget(member, interaction.member, await botMember(interaction)) : null;
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }

    const n = await store.exclusive(() => {
      const data = store.load();
      data.warns[user.id] = data.warns[user.id] || [];
      const entry = { id: Date.now(), mod: interaction.user.tag, reason, at: new Date().toISOString() };
      data.warns[user.id].push(entry);
      store.save(data);
      return data.warns[user.id].length;
    });

    try { await user.send(`⚠️ You have been warned on **${interaction.guild.name}**: ${reason} (total: ${n})`); } catch {}
    const { modActionEmbed } = require('../utils/embeds');
    const emb = modActionEmbed('warn', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason, extra: `Warn #${n}, total: ${n}` });
    await interaction.reply({ embeds: [emb] }).catch(async () => replyError(interaction, 'Warn recorded, but reply failed.'));
    await modLog(client, { embeds: [emb] });
  },
};
