const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Подтянуть бота в войс: к тебе или в указанный канал (музыка продолжается)')
    .addChannelOption(o => o.setName('channel').setDescription('Куда (по умолчанию — твой войс)').setRequired(false)),
  async execute(interaction, client) {
    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;
    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.reply({ content: '❌ Зайди в войс или на сцену (или укажи канал параметром).', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.reply({ content: `❌ Не могу зайти в войс:\n❌ ${pre.problems.join('\n❌ ')}`, flags: MessageFlags.Ephemeral });
        return;
      }
    } catch {}

    try {
      await music.join(client, voiceChannel, interaction.channel?.id);
      let extra = '';
      if (voiceChannel.type === 13) {
        try {
          const { stageWarning } = require('../modules/music/stage');
          extra = stageWarning(client, interaction.guildId);
        } catch {}
      }
      const label = voiceChannel.type === 13 ? 'на трибуну' : 'в войс';
      await interaction.reply(`🔊 Зашёл ${label}: **${voiceChannel.name}**.${extra}`);
    } catch (e) {
      await interaction.reply({ content: `❌ Не смог зайти: ${String(e.message || e).slice(0, 200)}`, flags: MessageFlags.Ephemeral });
    }
  },
};
