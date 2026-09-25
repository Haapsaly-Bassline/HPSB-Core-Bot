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
      // Buttons / modals / selects -> delegate to modcall module
      if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
        const modcall = require('../modules/modcall/handler');
        const handled = await modcall.handleInteraction(interaction, client);
        if (handled) return;
      }
    } catch (e) {
      logger.error('[interaction]', e?.stack || e);
      if (!interaction.isRepliable()) return;
      const payload = { content: '❌ Ошибка выполнения.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred) await interaction.followUp(payload);
        else if (!interaction.replied) await interaction.reply(payload);
      } catch {}
    }
  },
};
