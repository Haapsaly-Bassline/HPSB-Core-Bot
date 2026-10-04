const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Пропустить трек(и): 1, несколько сразу или весь альбом пачкой')
    .addIntegerOption(o => o.setName('count').setDescription('Сколько пропустить (по умолчанию 1)').setMinValue(1).setMaxValue(50).setRequired(false)),
  async execute(interaction, client) {
    const count = interaction.options.getInteger('count') || 1;
    const skipped = await music.skip(client, interaction.guildId, count);
    if (!skipped) {
      await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return;
    }
    let now = '';
    try {
      const v = music.queueView(client, interaction.guildId);
      if (v?.current) now = `\n▶️ Дальше: **${v.current.title}**`;
    } catch {}
    await interaction.reply(`⏭ Пропущено: **${skipped}**.${now}`);
  },
};
