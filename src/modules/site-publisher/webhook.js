// Приёмник для "своих сервисов": POST /hook/news { secret, title, description, url, image }
const express = require('express');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { newsEmbed } = require('../../utils/embeds');

function startWebhook(client) {
  const { port, secret, channelId } = config.webhook;
  if (!channelId) {
    logger.info('[webhook] skipped (no WEBHOOK_NEWS_CHANNEL_ID)');
    return;
  }
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  if (!secret) logger.warn('[webhook] WEBHOOK_SECRET пуст — постит сможет кто угодно. Задай секрет!');
  app.get('/health', (_, res) => res.json({ ok: true }));

  app.post('/hook/news', async (req, res) => {
    if (secret && req.body?.secret !== secret && req.headers['x-hpsb-secret'] !== secret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }
    const { title, description, url, image, source } = req.body || {};
    if (!title || !description) return res.status(400).json({ ok: false, error: 'title+description required' });
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return res.status(500).json({ ok: false, error: 'bad channel' });
      await ch.send({ embeds: [newsEmbed({ title, description, url, image, source: source || 'HPSB service' })] });
      res.json({ ok: true });
    } catch (e) {
      logger.warn('[webhook]', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.listen(port, () => logger.info(`[webhook] listening :${port} -> #${channelId}`));
}

module.exports = { startWebhook };
