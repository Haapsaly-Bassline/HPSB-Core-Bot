// /publisher: runtime source toggles (no restart, no .env edits).
// Priority: this override > PUBLISHER_* env > on. Persists across restarts.
// Toggling restarts the publisher module so timers/subscriptions rebuild
// exactly once (stop is null-safe, start guards duplicates).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { requireMod, replyError } = require('../utils/mod');
const { KNOWN, effectiveSources, setSourceOverride } = require('../modules/publisher/source-state');

const EMOJI = { youtube: '▶️', twitch: '🟣', instagram: '📸', tiktok: '🎵', hpsb: '🌐' };

function statusEmbed() {
  const eff = effectiveSources();
  const rows = KNOWN.map((k) => `${eff[k] ? '🟢' : '⚪'} ${EMOJI[k] || ''} **${k}** — ${eff[k] ? 'ON' : 'disabled'}`);
  return new EmbedBuilder().setColor(0x7c3aed).setTitle('📡 Publisher sources').setTimestamp()
    .setDescription(rows.join('\n') + '\n\n`PUBLISHER_*` in `.env` is the default; this override wins.')
    .setFooter({ text: 'Haapsaly Bassline • Publisher' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('publisher')
    .setDescription('Publisher sources: status / enable / disable / reset to .env')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(false)
      .addChoices(
        { name: 'status', value: 'status' },
        { name: 'enable', value: 'enable' },
        { name: 'disable', value: 'disable' },
        { name: 'reset', value: 'reset' }))
    .addStringOption(o => o.setName('source').setDescription('Which source').setRequired(false)
      .addChoices(...KNOWN.map((k) => ({ name: k, value: k })))),
  async execute(interaction, client) {
    if (!await requireMod(interaction)) return;
    const action = interaction.options.getString('action') || 'status';
    const source = interaction.options.getString('source');
    try {
      if (action === 'status' || !source) {
        await interaction.reply({ embeds: [statusEmbed()], flags: MessageFlags.Ephemeral });
        return;
      }
      if (!KNOWN.includes(source)) {
        await interaction.reply({ content: `❌ Unknown source. Available: ${KNOWN.join(', ')}.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (action === 'reset') {
        await setSourceOverride(source, null);
        await interaction.reply({ content: `↩️ **${source}**: runtime override cleared — \`.env\` default applies.`, flags: MessageFlags.Ephemeral });
      } else if (action === 'enable' || action === 'disable') {
        await setSourceOverride(source, action === 'enable');
        // Rebuild timers/subscriptions with the new flags (no full bot restart).
        let restarted = false;
        try {
          const manager = require('../modules/manager');
          if (manager.isEnabled('publisher')) {
            restarted = await manager.restart('publisher', client).catch(() => false);
          }
        } catch {}
        const state = effectiveSources()[source] ? 'ON' : 'disabled';
        await interaction.reply({
          content: `${state === 'ON' ? '🟢' : '⚪'} **${source}** is now ${state} (persists across restarts)${restarted ? '' : ' — publisher module not running, applies on next start'}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({ content: '❌ Unknown action. Use: status, enable, disable, reset.', flags: MessageFlags.Ephemeral });
        return;
      }
      // Refresh the /modules view data implicitly -- nothing cached there.
    } catch (e) {
      await replyError(interaction, `❌ Publisher error: ${String(e.message || e).slice(0, 200)}`);
    }
  },
};
