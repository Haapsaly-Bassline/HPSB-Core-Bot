const { Events } = require('discord.js');
const { handleVoiceState } = require('../modules/private/rooms');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    try {
      await handleVoiceState(oldState, newState, client);
    } catch (e) {
      logger.warn('[voiceStateUpdate]', e?.message || e);
    }
    // Stage: bot suppressed mid-session (mod/auto) -- request speak again, quietly and rarely
    try {
      if (!client?.user || newState.member?.id !== client.user.id) return;
      if (newState.channel?.type !== 13) return; // not stage
      if (oldState.suppress === true || newState.suppress !== true) return; // interested in transition to suppress
      const music = require('../modules/music/service');
      const p = client.music?.getPlayer?.(newState.guild.id);
      if (!p || (!p.playing && !p.paused)) return; // not playing -- don't bother
      const { becomeSpeaker } = require('../modules/music/stage');
      await becomeSpeaker(client, newState.guild.id, newState.channel.id, { cooldownMs: 60000 });
    } catch (e) {
      logger.warn('[voiceStateUpdate:stage]', e?.message || e);
    }
  },
};
