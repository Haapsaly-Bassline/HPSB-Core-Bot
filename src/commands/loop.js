const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const NAMES = { 0: 'Off ⏹', 1: 'Track 🔂', 2: 'Queue 🔁', 3: 'Autoplay ▶️' };

module.exports = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Режим повтора')
    .addIntegerOption(o => o.setName('mode').setDescription('Режим повтора').setRequired(true)
      .addChoices(
        { name: 'Off', value: 0 },
        { name: 'Track (текущий по кругу)', value: 1 },
        { name: 'Queue (вся очередь)', value: 2 },
        { name: 'Autoplay (похожие дальше)', value: 3 },
      )),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q) { await interaction.reply({ content: '❌ Нет очереди.', flags: MessageFlags.Ephemeral }); return; }
    const mode = interaction.options.getInteger('mode', true);
    q.setRepeatMode(mode);
    await interaction.reply(`🔁 Repeat: **${NAMES[mode] || mode}**.`);
  },
};
