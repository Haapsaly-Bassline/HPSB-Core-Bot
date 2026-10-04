// Трибуна (Stage): бот заходит подавленным слушателем (suppress) — звука нет,
// пока сцену не снимут. Просим спикера СРАЗУ при заходе и если подавили в процессе.
// Discord-метод: PATCH voice-states себя с suppress:false. Нужны права на сцене,
// иначе 403 — тогда падаем на request_to_speak (модер сцены подтвердит вручную).
const { Routes } = require('discord.js');
const { logger } = require('../../utils/logger');

const lastTry = new Map(); // guildId -> ts (антиспам повторных запросов)

async function becomeSpeaker(client, guildId, channelId, { force = false, cooldownMs = 15000 } = {}) {
  if (!force) {
    const last = lastTry.get(guildId) || 0;
    if (Date.now() - last < cooldownMs) return { ok: null, reason: 'cooldown' };
  }
  lastTry.set(guildId, Date.now());
  const me = client.user.id;
  // 1) снять подавление напрямую
  try {
    await client.rest.patch(Routes.guildVoiceState(guildId, me), {
      body: { channel_id: channelId, suppress: false },
    });
    logger.info(`[stage] speaker ON (${channelId})`);
    return { ok: true };
  } catch (e) {
    const code = e?.status ?? e?.code ?? '?';
    logger.warn(`[stage] unsuppress failed (${code}):`, String(e?.message || e).slice(0, 160));
    // 2) фолбэк: встать в очередь "хочу говорить" — подтвердит модер сцены
    try {
      await client.rest.patch(Routes.guildVoiceState(guildId, me), {
        body: { channel_id: channelId, request_to_speak_timestamp: new Date().toISOString() },
      });
      logger.info(`[stage] speak requested, waiting for moderator (${channelId})`);
      return { ok: false, reason: 'moderator', message: 'запрос на слово отправлен, нужен модер сцены' };
    } catch (e2) {
      const code2 = e2?.status ?? e2?.code ?? '?';
      logger.warn(`[stage] speak request failed (${code2}):`, String(e2?.message || e2).slice(0, 160));
      return { ok: false, reason: String(code2), message: e2?.message };
    }
  }
}

// Текст-предупреждение для ответов команд, если слово не дали (null = всё ок/молчим)
function stageWarning(client, guildId) {
  let st = null;
  try { st = require('./service').speakerStatus(client, guildId); } catch { st = null; }
  if (!st || st.ok !== false) return '';
  if (st.reason === 'moderator') return '\n⚠️ Я в слушателях: запрос на слово отправлен — попроси модера сцены выдать мне слово.';
  if (st.reason === 'cooldown') return '';
  return `\n⚠️ Не смог стать спикером (${st.reason || 'ошибка'}): звука на трибуне не будет. Проверь мои права на сцене.`;
}

module.exports = { becomeSpeaker, stageWarning };
