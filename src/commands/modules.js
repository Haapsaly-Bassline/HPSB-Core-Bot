const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requirePower, replyError } = require('../utils/mod');

const ACTIONS = ['status', 'enable', 'disable', 'restart', 'reset'];
const MODULES = ['music', 'publisher', 'automod', 'honeypot', 'modcall', 'stats', 'private'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modules')
    .setDescription('Bot modules: status / enable / disable / restart / reset to .env')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(false)
      .addChoices(...ACTIONS.map(a => ({ name: a, value: a }))))
    .addStringOption(o => o.setName('module').setDescription('Which module').setRequired(false)
      .addChoices(...MODULES.map(m => ({ name: m, value: m })))),
  async execute(interaction, client) {
    if (!await requirePower(interaction, PermissionFlagsBits.Administrator, 'Administrator')) return;
    const action = interaction.options.getString('action') || 'status';
    const name = interaction.options.getString('module');
    const { status, start, stop, restart, setOverride, resetOverride, defaultManifests } = require('../modules/manager');

    try {
      if (action === 'status' || !name) {
        const rows = status().map(s => `${s.running ? '🟢' : (s.enabled ? '🟡' : '⚪')} **${s.label}** \`${s.name}\`${s.running ? '' : (s.enabled ? ' — enabled, not running' : ' — disabled')}`);
        let srcRows = [];
        try {
          const { sourceStatus } = require('../modules/publisher');
          const { config } = require('../config');
          srcRows = sourceStatus(config).map(s =>
            `  ${s.state === 'on' ? '🟢' : s.state === 'disabled' ? '⚪' : '⚠️'} ${s.emoji} ${s.label} — ${s.state === 'on' ? 'ON' : s.state === 'disabled' ? 'disabled' : 'unavailable (not configured)'}`);
        } catch {}
        const desc = [...rows, '', '📡 **Publisher sources**', ...srcRows].join('\n');
        const e = new EmbedBuilder().setColor(0x7c3aed).setTitle('🧩 HPSB Core Modules').setTimestamp()
          .setDescription(desc)
          .setFooter({ text: 'Haapsaly Bassline • Modules' });
        await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
        return;
      }
      const known = defaultManifests().some(m => m.name === name);
      if (!known) {
        await interaction.reply({ content: `❌ Unknown module. Available: ${MODULES.join(', ')}.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'reset') {
        await resetOverride(name);
        await interaction.reply({ content: `↩️ **${name}**: runtime override cleared — .env default applies (restart to take effect if running state differs).`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'enable') {
        await setOverride(name, true);
        const ok = await start(name, client).catch(() => false);
        await interaction.reply({ content: ok ? `🟢 **${name}** enabled and started.` : `⚠️ **${name}** enabled, but start reported an issue — check logs.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'disable') {
        await setOverride(name, false);
        await stop(name, client).catch(() => {});
        await interaction.reply({ content: `⚪ **${name}** disabled and stopped (persists across restarts).`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'restart') {
        const ok = await restart(name, client).catch(() => false);
        await interaction.reply({ content: ok ? `🔄 **${name}** restarted.` : `⚠️ **${name}** restart reported an issue — check logs.`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: `❌ Unknown action. Use: ${ACTIONS.join(', ')}.`, flags: MessageFlags.Ephemeral });
    } catch (e) {
      await replyError(interaction, `❌ Modules error: ${String(e.message || e).slice(0, 200)}`);
    }
  },
};
