const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { requireMod } = require('../utils/mod');

function line(name, r) {
  return `**${name}:** найдено ${r.found}, опубликовано ${r.posted}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Принудительно синхронизировать ленты (релизы/события/посты/репостеры)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('backfill').setDescription('Докинуть последние N (0–5) даже если уже видены').setMinValue(0).setMaxValue(5)),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const backfill = interaction.options.getInteger('backfill') || 0;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { runHpsbOnce } = require('../modules/site-publisher/poller');
      const { runReposterOnce } = require('../modules/reposter/poller');
      const h = await runHpsbOnce(client, { backfill });
      const r = await runReposterOnce(client);
      if (!h || !r) {
        await interaction.editReply('⏳ Предыдущая синхронизация ещё идёт — попробуй через минуту.');
        return;
      }
      const e = new EmbedBuilder()
        .setColor(0x7c3aed).setTitle('🔄 Синхронизация').setTimestamp()
        .setDescription([
          line('💿 Релизы', h.releases),
          line('📅 События', h.events),
          line('📰 Посты', h.posts),
          line('⏰ Напоминания', h.reminders),
          line('▶️ YouTube', r.youtube),
          line('🎵 TikTok', r.tiktok),
          line('📸 Instagram', r.instagram),
        ].join('\n'))
        .setFooter({ text: `${backfill ? `backfill=${backfill} • ` : ''}Haapsaly Bassline` });
      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await interaction.editReply(`❌ Ошибка синхронизации: ${String(err.message || err).slice(0, 300)}`).catch(() => {});
    }
  },
};
