// Приёмник для "своих сервисов" (и Make/Zapier-триггеров):
// POST /hook/news { secret, title, description, url, image, source, twitch, links }
// twitch: ссылка на параллельный стрим (кнопкой, без отдельного поста).
// links: [{ label, url }] — доп. кнопки.
const express = require('express');
const { EmbedBuilder } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { newsEmbed, announcePing } = require('../../utils/embeds');

const SOURCE_STYLE = [
  { match: 'instagram', color: 0xe1306c, emoji: '📸', tag: 'Instagram' },
  { match: 'tiktok', color: 0x1a1a1a, emoji: '🎵', tag: 'TikTok' },
  { match: 'youtube', color: 0xff0000, emoji: '▶️', tag: 'YouTube' },
  { match: 'twitch', color: 0x9146ff, emoji: '🟣', tag: 'Twitch' },
];

function styledEmbed({ title, description, url, image, source }) {
  const s = String(source || '').toLowerCase();
  const st = SOURCE_STYLE.find(x => s.includes(x.match));
  if (!st) return newsEmbed({ title, description, url, image, source: source || 'HPSB service' });
  const e = new EmbedBuilder().setColor(st.color).setTimestamp()
    .setTitle(`${st.emoji} ${String(title).slice(0, 250)}`);
  if (url) e.setURL(url);
  if (description) e.setDescription(String(description).slice(0, 2000));
  if (image) e.setImage(image);
  e.setFooter({ text: `Haapsaly Bassline • ${st.tag}` });
  return e;
}

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
    // Токен любым способом: body.secret, x-hpsb-secret, x-webhook-secret,
    // x-api-key, Authorization: Bearer
    const hdr = req.headers || {};
    const auth = String(hdr.authorization || '');
    const token = req.body?.secret
      || hdr['x-hpsb-secret']
      || hdr['x-webhook-secret']
      || hdr['x-api-key']
      || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null);
    if (secret && token !== secret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }
    const { title, description, url, image, source, twitch, links } = req.body || {};
    if (!title || !description) return res.status(400).json({ ok: false, error: 'title+description required' });
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch?.isTextBased()) return res.status(500).json({ ok: false, error: 'bad channel' });
      const ping = announcePing();
      const payload = { embeds: [styledEmbed({ title, description, url, image, source })] };
      if (ping) payload.content = ping;
      // Кнопки: основная ссылка + Twitch «за компанию» + любые доп. links
      const { linkButtonRows } = require('../../utils/embeds');
      const btns = [];
      if (url) btns.push({ label: /twitch/i.test(source || '') ? 'Twitch' : 'Watch', url });
      if (twitch) btns.push({ label: 'Twitch', url: twitch });
      if (Array.isArray(links)) {
        for (const l of links.slice(0, 8)) {
          if (l?.url) btns.push({ label: String(l.label || 'Link').slice(0, 80), url: l.url });
        }
      }
      // убираем дубли по url
      const seen = new Set();
      const uniq = btns.filter(b => {
        try { const u = new URL(b.url).href; if (seen.has(u)) return false; seen.add(u); return true; }
        catch { return false; }
      });
      if (uniq.length) payload.components = linkButtonRows(uniq.slice(0, 25));
      await ch.send(payload);
      res.json({ ok: true });
    } catch (e) {
      logger.warn('[webhook]', e.message);
      res.status(500).json({ ok: false });
    }
  });

  app.listen(port, () => logger.info(`[webhook] listening :${port} -> #${channelId}`));
}

module.exports = { startWebhook };
