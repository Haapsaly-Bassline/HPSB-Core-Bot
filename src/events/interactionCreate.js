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
      // Partner post modal -> dedicated handler on the command module
      if (interaction.isModalSubmit() && interaction.customId === 'partner-post:modal') {
        const cmd = client.commands.get('partner-post');
        if (cmd?.handleModal) {
          const handled = await cmd.handleModal(interaction, client);
          if (handled !== false) return;
        }
      }
      // Roles audit fix buttons
      if (interaction.isButton() && interaction.customId.startsWith('roles:fix:')) {
        const cmd = client.commands.get('roles');
        if (cmd?.handleButton) {
          const handled = await cmd.handleButton(interaction, client);
          if (handled) return;
        }
      }
      // Private rooms: buttons/modals/selects
      if ((interaction.isButton() || interaction.isModalSubmit() || interaction.isUserSelectMenu())
        && interaction.customId.startsWith('priv:')) {
        const priv = require('../modules/private/rooms');
        const handled = await priv.handleInteraction(interaction, client);
        if (handled) return;
      }
      // Buttons / modals -> delegate to modcall module (it handles no string selects;
      // passing those in would time them out silently, so gate them out here)
      if (interaction.isButton() || interaction.isModalSubmit()) {
        const modcall = require('../modules/modcall/handler');
        const handled = await modcall.handleInteraction(interaction, client);
        if (handled) return;
      }
      if (interaction.isStringSelectMenu() && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Unknown menu.', flags: MessageFlags.Ephemeral }).catch(() => {});
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
