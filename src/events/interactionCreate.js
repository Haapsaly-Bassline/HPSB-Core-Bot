const { Events, MessageFlags } = require('discord.js');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      // Slash commands
      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;
        await cmd.execute(interaction, client);
        return;
      }
      // Live Now Playing buttons
      if (interaction.isButton() && interaction.customId.startsWith('np:')) {
        const np = require('../modules/music/np');
        const handled = await np.handleButton(interaction, client);
        if (handled) return;
      }
    } catch (e) {
      logger.error('[interaction]', e?.stack || e);
      if (!interaction.isRepliable()) return;
      const payload = { content: '❌ Execution error.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred) await interaction.followUp(payload);
        else if (!interaction.replied) await interaction.reply(payload);
      } catch {}
    }
  },
};
