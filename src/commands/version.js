const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const pkg = require('../../package.json');
const { config } = require('../config');

function uptimeStr(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}д ${h}ч ${m}м`;
}

module.exports = {
  data: new SlashCommandBuilder().setName('version').setDescription('Версия бота и окружение'),
  async execute(interaction, client) {
    const lavalink = client.lavalink ? 'подключён' : (config.music.engine === 'lavalink' ? 'флаг on, нет соединения' : 'выкл');
    const e = new EmbedBuilder()
      .setColor(0x7c3aed).setTitle(`🤖 HPSB Core Bot v${pkg.version}`).setTimestamp()
      .addFields(
        { name: 'Сборка', value: process.env.BUILD_DATE || 'dev', inline: true },
        { name: 'Node', value: process.version, inline: true },
        { name: 'Аптайм', value: uptimeStr(process.uptime() * 1000), inline: true },
        { name: 'Муз-движок', value: `${config.music.engine} (discord-player + lavalink ${lavalink})`, inline: false },
        { name: 'Очередь сейчас', value: client.player?.nodes?.get(interaction.guildId)?.currentTrack?.title || 'пусто', inline: false },
      )
      .setFooter({ text: 'Haapsaly Bassline' });
    await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
