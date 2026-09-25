const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, resolveMember, protectedTarget, modLog } = require('../utils/mod');
const store = require('../utils/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Выдать предупреждение')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Кому').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(false)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Без причины';
    const member = await resolveMember(interaction, user);
    const blocked = member ? protectedTarget(member, interaction.user.id) : null;
    if (blocked) { await interaction.reply({ content: `❌ ${blocked}`, flags: MessageFlags.Ephemeral }); return; }

    const data = store.load();
    data.warns[user.id] = data.warns[user.id] || [];
    const entry = { id: Date.now(), mod: interaction.user.tag, reason, at: new Date().toISOString() };
    data.warns[user.id].push(entry);
    store.save(data);
    const n = data.warns[user.id].length;

    try { await user.send(`⚠️ Тебе выдан варн на **${interaction.guild.name}**: ${reason} (всего: ${n})`); } catch {}
    const { modActionEmbed } = require('../utils/embeds');
    const emb = modActionEmbed('warn', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason, extra: `Варн #${n}, всего: ${n}` });
    await interaction.reply({ embeds: [emb] });
    await modLog(client, { embeds: [emb] });
  },
};
