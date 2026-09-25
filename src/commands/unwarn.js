const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { requireMod, modLog } = require('../utils/mod');
const store = require('../utils/store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unwarn')
    .setDescription('Снять варн (последний или по номеру)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('У кого').setRequired(true))
    .addIntegerOption(o => o.setName('number').setDescription('Номер варна (по умолч. последний)').setMinValue(1)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const user = interaction.options.getUser('user', true);
    const data = store.load();
    const list = data.warns[user.id] || [];
    if (!list.length) { await interaction.reply({ content: `✅ У ${user} варнов нет.`, flags: MessageFlags.Ephemeral }); return; }
    const n = interaction.options.getInteger('number') || list.length;
    if (n < 1 || n > list.length) { await interaction.reply({ content: `❌ Варна #${n} нет (всего ${list.length}).`, flags: MessageFlags.Ephemeral }); return; }
    const [rm] = list.splice(n - 1, 1);
    store.save(data);
    const { modActionEmbed } = require('../utils/embeds');
    const emb = modActionEmbed('unwarn', { target: `${user} (${user.id})`, mod: `${interaction.user}`, reason: `Снят #${n}: ${rm.reason}` });
    await interaction.reply({ embeds: [emb] });
    await modLog(client, { embeds: [emb] });
  },
};
