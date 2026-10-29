const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../modules/music/service');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Pull the bot into voice: to you or a specified channel (music continues)')
    .addChannelOption(o => o.setName('channel').setDescription('Where (defaults to your voice channel)').setRequired(false)),
  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const voiceChannel = interaction.options.getChannel('channel')
      || interaction.member?.voice?.channel;
    if (!voiceChannel || ![2, 13].includes(voiceChannel.type)) {
      await interaction.editReply('❌ Join a voice channel or stage (or specify one via the channel option).');
      return;
    }

    let pre;
    try {
      const { checkVoice } = require('../utils/selfcheck');
      pre = await checkVoice(client, voiceChannel);
    } catch (error) {
      await interaction.editReply(`❌ Couldn't verify voice permissions: ${String(error?.message || error).slice(0, 180)}`);
      return;
    }
    if (!pre.ok) {
      await interaction.editReply(`❌ Can't join that voice channel:\n❌ ${pre.problems.join('\n❌ ')}`);
      return;
    }

    try {
      await music.join(client, voiceChannel, interaction.channel?.id);
      let extra = '';
      if (voiceChannel.type === 13) {
        try {
          const { stageWarning } = require('../modules/music/stage');
          extra = stageWarning(client, interaction.guildId);
        } catch {}
      }
      const { ack, COLORS } = require('../utils/embeds');
      const label = voiceChannel.type === 13 ? 'the stage' : 'the voice channel';
      await interaction.editReply({ embeds: [ack(`🔊 Joined ${label}`, `**${voiceChannel.name}**${extra}`, { color: COLORS.success })] });
    } catch (e) {
      await interaction.editReply(`❌ Couldn't join: ${String(e.message || e).slice(0, 200)}`);
    }
  },
};
