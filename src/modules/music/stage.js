// Stage: bot joins as suppressed listener (suppress) -- no audio
// until unsuppressed. Request speaker IMMEDIATELY on join and if suppressed mid-session.
// Discord method: PATCH own voice-state with suppress:false. Need stage permissions,
// otherwise 403 -> fall back to request_to_speak (stage moderator confirms manually).
const { Routes } = require('discord.js');
const { logger } = require('../../utils/logger');

const lastTry = new Map(); // guildId -> ts (anti-spam for repeat requests)

async function becomeSpeaker(client, guildId, channelId, { force = false, cooldownMs = 15000 } = {}) {
  if (!force) {
    const last = lastTry.get(guildId) || 0;
    if (Date.now() - last < cooldownMs) return { ok: null, reason: 'cooldown' };
  }
  lastTry.set(guildId, Date.now());
  const me = client.user.id;
  // 1) unsuppress directly
  try {
    await client.rest.patch(Routes.guildVoiceState(guildId, me), {
      body: { channel_id: channelId, suppress: false },
    });
    logger.info(`[stage] speaker ON (${channelId})`);
    return { ok: true };
  } catch (e) {
    const code = e?.status ?? e?.code ?? '?';
    logger.warn(`[stage] unsuppress failed (${code}):`, String(e?.message || e).slice(0, 160));
    // 2) fallback: join "want to speak" queue -- moderator confirms
    try {
      await client.rest.patch(Routes.guildVoiceState(guildId, me), {
        body: { channel_id: channelId, request_to_speak_timestamp: new Date().toISOString() },
      });
      logger.info(`[stage] speak requested, waiting for moderator (${channelId})`);
      return { ok: false, reason: 'moderator', message: 'speak request sent, a stage moderator is needed' };
    } catch (e2) {
      const code2 = e2?.status ?? e2?.code ?? '?';
      logger.warn(`[stage] speak request failed (${code2}):`, String(e2?.message || e2).slice(0, 160));
      return { ok: false, reason: String(code2), message: e2?.message };
    }
  }
}

// Warning text for command responses if speaker not granted (null = all good/silent)
function stageWarning(client, guildId) {
  let st = null;
  try { st = require('./service').speakerStatus(client, guildId); } catch { st = null; }
  if (!st || st.ok !== false) return '';
  if (st.reason === 'moderator') return '\n⚠️ I am a listener: speak request sent — ask a stage moderator to give me the floor.';
  if (st.reason === 'cooldown') return '';
  return `\n⚠️ Couldn't become a speaker (${st.reason || 'error'}): no sound on stage. Check my stage permissions.`;
}

module.exports = { becomeSpeaker, stageWarning };
