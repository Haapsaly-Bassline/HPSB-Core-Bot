const { Events } = require('discord.js');
const { handleVoiceState } = require('../modules/private/rooms');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    await handleVoiceState(oldState, newState, client).catch(() => {});
    // Трибуна: бота подавили в процессе (модер/авто) — просим слово заново, тихо и редко
    try {
      if (!client?.user || newState.member?.id !== client.user.id) return;
      if (newState.channel?.type !== 13) return; // не сцена
      if (oldState.suppress === true || newState.suppress !== true) return; // интересует переход в suppress
      const music = require('../modules/music/service');
      const p = client.music?.getPlayer?.(newState.guild.id);
      if (!p || (!p.playing && !p.paused)) return; // не играет — не лезем
      const { becomeSpeaker } = require('../modules/music/stage');
      await becomeSpeaker(client, newState.guild.id, newState.channel.id, { cooldownMs: 60000 });
    } catch {}
  },
};
