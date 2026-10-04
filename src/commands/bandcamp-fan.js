const { SlashCommandBuilder } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bandcamp-fan')
    .setDescription('Купленное с Bandcamp fan-профиля в очередь (альбомы как плейлисты)')
    .addStringOption(o => o.setName('url').setDescription('Ссылка вида https://bandcamp.com/username').setRequired(true))
    .addIntegerOption(o => o.setName('count').setDescription('Сколько релизов взять (1-25, по умолчанию 10)').setMinValue(1).setMaxValue(25).setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Войс-канал (по умолчанию твой)').setRequired(false)),
  async execute(interaction, client) {
    const url = interaction.options.getString('url', true);
    const count = interaction.options.getInteger('count') || 10;
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;
    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.editReply('❌ Зайди в войс или на сцену (или укажи канал параметром).');
      return;
    }

    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.editReply(`❌ Не могу зайти в войс:\n❌ ${pre.problems.join('\n❌ ')}`);
        return;
      }
    } catch {}

    try {
      const { fanCollectionEmbed } = require('../utils/embeds');
      const res = await music.playFan(client, voiceChannel, url, {
        requester: interaction.user,
        textChannel: interaction.channel,
        limit: count,
      });
      const emb = fanCollectionEmbed(
        {
          fanName: `${res.fan.name} (@${res.fan.username})`,
          fanUrl: `https://bandcamp.com/${res.fan.username}`,
          added: res.added, failed: res.failed, totalTracks: res.totalTracks,
        },
        interaction.user,
      );
      await interaction.editReply({ embeds: [emb] });
    } catch (e) {
      await interaction.editReply(`❌ Не смог собрать коллекцию: ${String(e.message || e).slice(0, 300)}`);
    }
  },
};
