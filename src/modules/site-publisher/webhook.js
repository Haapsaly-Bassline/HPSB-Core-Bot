// Receiver for "own services" (and Make/Zapier triggers):
// POST /hook/news { secret, title, description, url, image, source, twitch, links }
// twitch: parallel stream link (as button, without separate post).
// links: [{ label, url }] -- extra buttons.
const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const { EmbedBuilder } = require('discord.js');
const { config } = require('../../config');
const { logger } = require('../../utils/logger');
const { newsEmbed, mediaPing } = require('../../utils/embeds');

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

  if (!secret) logger.warn('[webhook] WEBHOOK_SECRET empty -- anyone can post. Set a secret!');
  app.get('/health', (_, res) => res.json({ ok: true }));

// ---------- YouTube PubSubHubbub: pushes instead of polling (0 ops in Make) ----------
// Google hits this on video upload. Subscription renews every 4 days.
  app.use('/hook/youtube', express.text({ type: '*/*', limit: '256kb' }));
  app.get('/hook/youtube', (req, res) => {
    const mode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    if ((mode === 'subscribe' || mode === 'unsubscribe' || mode === 'denied') && challenge) {
      // Verify the topic is one of OUR channels -- otherwise anyone could confirm
      // a forged subscription and push fake entries to our feed.
      const topic = String(req.query['hub.topic'] || '');
      let channelId = '';
      try { channelId = new URL(topic).searchParams.get('channel_id') || ''; } catch {}
      const known = (config.reposter.youtube || []).some(x => x.key === channelId);
      if (mode === 'subscribe' && !known) {
        logger.warn('[pubsub] verify REFUSED for unknown topic:', topic.slice(0, 120));
        return res.status(404).send('unknown topic');
      }
      logger.info(`[pubsub] verify ${mode}: ${topic}`);
      return res.status(200).send(String(challenge));
    }
    return res.status(400).send('bad verify');
  });
  const atomParser = new XMLParser({ ignoreAttributes: false });
  const inflight = new Set(); // videoId being processed right now (concurrent dup delivery guard)
  app.post('/hook/youtube', async (req, res) => {
    res.status(200).send('ok'); // respond immediately, process later
    try {
      const xml = typeof req.body === 'string' ? req.body : '';
      if (!xml.includes('<entry')) return;
      const feed = atomParser.parse(xml);
      const raw = feed?.feed?.entry;
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const feedChannel = String(feed?.feed?.['yt:channelId'] || '');
      const { publishYouTubeVideo } = require('../reposter/poller');
      for (const en of entries.slice(0, 5)) {
        const videoId = String(en?.['yt:videoId'] || '').trim();
        if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue; // garbage/object instead of id
        const key = `${feedChannel}:${videoId}`;
        if (inflight.has(key)) continue;
        inflight.add(key);
        try {
          await publishYouTubeVideo(client, {
            videoId,
            title: typeof en.title === 'string' ? en.title : '',
            author: typeof en?.author?.name === 'string' ? en.author.name : '',
            channelId: feedChannel,
          });
        } finally {
          inflight.delete(key);
        }
      }
    } catch (e) { logger.warn('[pubsub]', e.message); }
  });
  subscribeYouTube(client).catch(e => logger.warn('[pubsub] init failed', e.message));

  app.post('/hook/news', async (req, res) => {
    // Token by any method: body.secret, x-hpsb-secret, x-webhook-secret,
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
      const ping = mediaPing();
      const payload = { embeds: [styledEmbed({ title, description, url, image, source })] };
      if (ping) payload.content = ping;
      // Buttons: main link + Twitch "on the side" + any extra links
      const { linkButtonRows } = require('../../utils/embeds');
      const btns = [];
      if (url) btns.push({ label: /twitch/i.test(source || '') ? 'Twitch' : 'Watch', url });
      if (twitch) btns.push({ label: 'Twitch', url: twitch });
      if (Array.isArray(links)) {
        for (const l of links.slice(0, 8)) {
          if (l?.url) btns.push({ label: String(l.label || 'Link').slice(0, 80), url: l.url });
        }
      }
      // remove duplicates by url
      const seen = new Set();
      const uniq = btns.filter(b => {
        try { const u = new URL(b.url).href; if (seen.has(u)) return false; seen.add(u); return true; }
        catch { return false; }
      });
      if (uniq.length) payload.components = linkButtonRows(uniq.slice(0, 25));
      const posted = await ch.send(payload).catch(() => null);
      if (!posted) return res.status(500).json({ ok: false, error: 'send failed' });
      const { ChannelType } = require('discord.js');
      if (ch.type === ChannelType.GuildAnnouncement) {
        await posted.crosspost().catch(() => {});
      }
      res.json({ ok: true });
    } catch (e) {
      logger.warn('[webhook]', e.message);
      res.status(500).json({ ok: false });
    }
  });

  // Listen on all interfaces: Caddy may be local or on adjacent host.
  // EADDRINUSE = stale duplicate bot instance running: fail LOUD and fast
  // instead of dying with an unhandled 'error' throw and zero context.
  const server = app.listen(port, () => logger.info(`[webhook] listening :${port} -> #${channelId}`));
  server.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') {
      logger.error(`[webhook] port ${port} busy -- another bot instance is already running. Kill the stale node process first, then start again.`);
    } else {
      logger.error('[webhook] listen failed:', e?.message || e);
    }
    process.exit(1);
  });
}

// YT channels PubSubHubbub subscription (leases up to 5 days -- renew every 4 days)
let subTimer = null;
async function subscribeYouTube(client) {
  const base = (config.webhook.publicBase || '').replace(/\/$/, '');
  const channels = config.reposter.youtube.map(x => x.key).filter(Boolean);
  if (!base || !channels.length) {
    logger.info('[pubsub] skipped (no WEBHOOK_PUBLIC_BASE or YOUTUBE_MAP)');
    return;
  }
  const run = async () => {
    for (const ytId of channels) {
      try {
        await axios.post('https://pubsubhubbub.appspot.com/subscribe',
          new URLSearchParams({
            'hub.callback': `${base}/hook/youtube`,
            'hub.mode': 'subscribe',
            'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${ytId}`,
            'hub.verify': 'async',
            'hub.lease_seconds': '432000',
          }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
        logger.info(`[pubsub] subscribed ${ytId}`);
      } catch (e) { logger.warn('[pubsub] sub failed', ytId, e.message); }
    }
  };
  await run().catch(() => {});
  if (subTimer) clearInterval(subTimer);
  subTimer = setInterval(() => run().catch(() => {}), 4 * 24 * 3600 * 1000);
  subTimer.unref?.();
}

module.exports = { startWebhook };
