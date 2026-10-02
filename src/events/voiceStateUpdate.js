const { Events } = require('discord.js');
const { handleVoiceState } = require('../modules/private/rooms');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    await handleVoiceState(oldState, newState, client).catch(() => {});
  },
};
