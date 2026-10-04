const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');
module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Skip track(s): one, several at once, or a whole album batch')
    .addIntegerOption(o => o.setName('count').setDescription('How many to skip (default 1)').setMinValue(1).setMaxValue(50).setRequired(false)),
  async execute(interaction, client) {
    const count = interaction.options.getInteger('count') || 1;
    const skipped = await music.skip(client, interaction.guildId, count);
    if (!skipped) {
      await interaction.reply({ content: '❌ Nothing is playing.', flags: MessageFlags.Ephemeral }); return;
    }
    let now = '';
    try {
      const v = music.queueView(client, interaction.guildId);
      if (v?.current) now = `\n▶️ Up next: **${v.current.title}**`;
    } catch {}
    await interaction.reply(`⏭ Skipped: **${skipped}**.${now}`);
  },
};
