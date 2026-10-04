const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Pull the bot into voice: to you or a specified channel (music continues)')
    .addChannelOption(o => o.setName('channel').setDescription('Where (defaults to your voice channel)').setRequired(false)),
  async execute(interaction, client) {
    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;
    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.reply({ content: '❌ Join a voice channel or stage (or specify one via the channel option).', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const { checkVoice } = require('../utils/selfcheck');
      const pre = await checkVoice(client, voiceChannel);
      if (!pre.ok) {
        await interaction.reply({ content: `❌ Can't join that voice channel:\n❌ ${pre.problems.join('\n❌ ')}`, flags: MessageFlags.Ephemeral });
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
      const label = voiceChannel.type === 13 ? 'the stage' : 'the voice channel';
      await interaction.reply(`🔊 Joined ${label}: **${voiceChannel.name}**.${extra}`);
    } catch (e) {
      await interaction.reply({ content: `❌ Couldn't join: ${String(e.message || e).slice(0, 200)}`, flags: MessageFlags.Ephemeral });
    }
  },
};
