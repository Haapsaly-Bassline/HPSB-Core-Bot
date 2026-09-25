const { SlashCommandBuilder, MessageFlags } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Что сейчас играет'),
  async execute(interaction, client) {
    const q = client.player.nodes.get(interaction.guildId);
    if (!q?.currentTrack) { await interaction.reply({ content: '❌ Ничего не играет.', flags: MessageFlags.Ephemeral }); return; }
    const t = q.currentTrack;
    await interaction.reply(`▶️ **${t.title}** — ${t.author} (${t.duration})`);
  },
};
