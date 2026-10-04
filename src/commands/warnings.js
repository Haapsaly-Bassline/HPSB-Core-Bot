const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requireMod } = require('../utils/mod');
const store = require('../utils/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Show user warnings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Whose').setRequired(true)),
  async execute(interaction) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const list = (store.load().warns[user.id] || []).slice(-15);
    if (!list.length) { await interaction.reply({ content: `✅ ${user} has no warnings.`, flags: MessageFlags.Ephemeral }); return; }
    const e = new EmbedBuilder()
      .setColor(0xf59e0b).setTitle(`⚠️ Warnings: ${user.tag}`)
      .setDescription(list.map((w, i) => `\`${i + 1}.\` ${w.reason} — ${w.mod} (<t:${Math.floor(new Date(w.at).getTime() / 1000)}:R>)`).join('\n').slice(0, 3900))
      .setFooter({ text: `Total: ${list.length} • Haapsaly Bassline` });
    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
