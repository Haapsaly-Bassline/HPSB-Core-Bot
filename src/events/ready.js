const { Events } = require('discord.js');
const { logger } = require('../utils/logger');
const { config } = require('../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`[ready] Logged in as ${client.user.tag}`);

    // Lavalink — только ПОСЛЕ ready: client.user существует, так требует lavalink-client.
    // Бот исключительно на lavalink: legacy-фолбэка больше нет. Не поднялся — музыка
    // недоступна, команды отвечают "Music engine не инициализирован".
    if (config.music.engine === 'lavalink') {
      try {
        const { LavalinkEngine } = require('../modules/music/engine-lavalink');
        const engine = await new LavalinkEngine(client, config.music).init();
        client.music = engine;
        client.lavalink = engine;
        logger.info('[lavalink] ready (client.music = lavalink)');
      } catch (e) {
        logger.error('[lavalink] init failed:', e?.message || e?.stack || e);
        logger.error('[lavalink] музыка НЕДОСТУПНА: проверь LAVALINK_* в .env и что запущен java -jar Lavalink.jar');
      }
    } else {
      logger.error(`[music] MUSIC_ENGINE=${config.music.engine} больше не поддерживается — legacy удалён, поставь lavalink`);
    }

    // Start pollers lazily so index stays lean
    try {
      const { startReposter } = require('../modules/reposter/poller');
      startReposter(client);
    } catch (e) { logger.warn('[reposter] disabled:', e.message); }

    try {
      const { startSitePoller } = require('../modules/site-publisher/poller');
      startSitePoller(client);
    } catch (e) { logger.warn('[site] disabled:', e.message); }

    try {
      const { startWebhook } = require('../modules/site-publisher/webhook');
      startWebhook(client);
    } catch (e) { logger.warn('[webhook] disabled:', e.message); }

    try {
      const { ensureTrapWarning } = require('../modules/honeypot/detector');
      await ensureTrapWarning(client);
    } catch (e) { logger.warn('[honeypot] disabled:', e.message); }

    try {
      const { startStats } = require('../modules/stats/counter');
      startStats(client);
    } catch (e) { logger.warn('[stats] disabled:', e.message); }

    // Самопроверка прав при старте — без плейсхолдеров, живьём из API
    try {
      const { auditGuild } = require('../utils/selfcheck');
      const { missing } = await auditGuild(client);
      if (missing.length) {
        const id = config.logChannelId || config.honeypot.logChannelId;
        const ch = id ? await client.channels.fetch(id).catch(() => null) : null;
        if (ch?.isTextBased()) {
          await ch.send(`⚠️ **Self-check:** боту не хватает прав на сервере:\n❌ ${missing.join('\n❌ ')}`).catch(() => {});
        }
      }
    } catch (e) { logger.warn('[selfcheck] disabled:', e.message); }

    if (config.modcall.panelChannelId) {
      logger.info('[modcall] ready, use /modcall-panel to post the button');
    }
  },
};
