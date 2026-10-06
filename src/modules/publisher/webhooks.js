// Unified Publisher webhook server: ONE express instance for all sources.
//   GET/POST /hook/youtube   - PubSubHubbub push (primary YT path)
//   POST     /hook/twitch    - EventSub stream.online/offline (HMAC-verified)
//   POST     /hook/instagram - official API / legacy Make -> normalize -> ingest
//   POST     /hook/hpsb      - internal services { type, id, ... } -> ingest
//   POST     /hook/news      - LEGACY compat (old Make workflow), same pipeline
//   GET      /health         - liveness
// When the publisher module is disabled at runtime, /hook/* answer 503
// (never accept events we would silently drop).
const express = require('express');
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');
const { logger } = require('../../utils/logger');
const liveMod = require('./live');
const { format } = require('./formatter');
const { pingFor, resolveChannel } = require('./router');
const { verifySignature, normalizeOnline } = require('./sources/twitch');
const { normalizeWebhook: normalizeIg } = require('./sources/instagram');
const { saveState } = require('./state');

const atomParser = new XMLParser({ ignoreAttributes: false });

let httpServer = null;
let subTimer = null;
let ctx = null; // { client, pipeline, config, getLive, setLive }

function publisherEnabled() {
  try {
    return require('../manager').isEnabled('publisher');
  } catch { return true; }
}

async function persist() {
  try {
    await saveState({ seen: ctx.pipeline.dedup.dumpSeen(), live: ctx.getLive() || {} });
  } catch {}
}

// --- LIVE message create/update -------------------------------------------
async function sendLiveMessage(ev) {
  if (!ctx) return null;
  const { client, config, getLive } = ctx;
  const st = getLive();
  const channelId = resolveChannel('announcements', config);
  if (!channelId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch?.isTextBased()) return null;
  const buttons = liveMod.liveButtons(st, config?.publisher || {});
  const { embed, components } = format(ev, { liveButtons: buttons });
  const payload = { embeds: [embed] };
  const ping = pingFor('announcements', config);
  if (ping) payload.content = ping;
  if (components?.length) payload.components = components;
  const m = await ch.send(payload).catch((e) => {
    logger.warn('[publisher/live] send failed:', e.message);
    return null;
  });
  return m;
}

async function editLiveMessage(ev, ended = false, refOverride = null) {
  if (!ctx) return false;
  const { client, config, getLive } = ctx;
  const st = getLive();
  const ref = refOverride || st?.discord;
  if (!ref?.messageId || !ref?.channelId) return false;
  const ch = await client.channels.fetch(ref.channelId).catch(() => null);
  if (!ch?.isTextBased()) return false;
  const m = await ch.messages.fetch(ref.messageId).catch(() => null);
  if (!m) return false;
  const buttons = ended ? [] : liveMod.liveButtons(st, config?.publisher || {});
  const built = ended
    ? { embed: format({ ...ev, description: 'The stream has ended. Thanks for watching!' }).embed, components: [] }
    : format(ev, { liveButtons: buttons });
  const payload = { embeds: [built.embed] };
  if (built.components?.length) payload.components = built.components;
  await m.edit(payload).catch((e) => logger.warn('[publisher/live] edit failed:', e.message));
  return true;
}

// Serialize live transitions: concurrent online signals (YT+Twitch, EventSub
// redelivery) must not both take the 'create' branch and orphan a message.
let liveChain = Promise.resolve();
function withLiveLock(fn) {
  const run = liveChain.then(fn, fn);
  liveChain = run.catch(() => {});
  return run;
}

// Returns 'create' | 'update' | 'noop' | 'ended' handling + Discord I/O.
async function handleLiveOnline(source, ref, ev) {
  if (!ctx) return;
  return withLiveLock(async () => {
    if (!ctx) return;
    const st = ctx.getLive();
    const action = liveMod.applyOnline(st, source, ref);
    if (action === 'noop') return;
    if (action === 'create') {
      const m = await sendLiveMessage(ev);
      if (m) st.discord = { channelId: m.channelId || resolveChannel('announcements', ctx.config), messageId: m.id };
    } else {
      await editLiveMessage(ev);
    }
    await persist();
  });
}

async function handleLiveOffline(source, ev) {
  if (!ctx) return;
  return withLiveLock(async () => {
    if (!ctx) return;
    const st = ctx.getLive();
    // Capture the message ref BEFORE applyOffline clears it on 'ended'.
    const ref = st?.discord?.messageId ? { ...st.discord } : null;
    const action = liveMod.applyOffline(st, source);
    if (action === 'noop') return;
    if (action === 'ended') {
      await editLiveMessage(ev || { source, type: 'live', title: 'Stream' }, true, ref);
    } else {
      await editLiveMessage(ev || { source, type: 'live', title: 'HPSB LIVE' }, false, ref);
    }
    await persist();
  });
}

// --- YouTube PubSubHubbub ---------------------------------------------------
function ytVerify(req, res) {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  if ((mode === 'subscribe' || mode === 'unsubscribe' || mode === 'denied') && challenge) {
    const topic = String(req.query['hub.topic'] || '');
    let channelId = '';
    try { channelId = new URL(topic).searchParams.get('channel_id') || ''; } catch {}
    const known = (ctx.config?.reposter?.youtube || []).some((x) => x.key === channelId);
    if (!known) {
      logger.warn(`[publisher/youtube] verify REFUSED for unknown topic (${mode}):`, topic.slice(0, 120));
      return res.status(404).send('unknown topic');
    }
    logger.info(`[publisher/youtube] PubSub verify ${mode}: ${topic}`);
    return res.status(200).send(String(challenge));
  }
  return res.status(400).send('bad verify');
}

async function ytNotify(req, res) {
  res.status(200).send('ok'); // ack fast, process after
  try {
    const { isSourceOn } = require('./source-state');
    if (!isSourceOn('youtube')) {
      logger.info('[publisher/youtube] push ignored (source disabled)');
      return;
    }
    // Authenticated pushes (see hub.secret in subscribeYouTube): Google signs
    // the raw XML with X-Hub-Signature: sha1=<hmac>. Unsigned accepts happen
    // only when no secret is configured at all.
    const secret = ctx.config?.webhook?.secret || '';
    if (secret) {
      const sig = String(req.headers['x-hub-signature'] || '');
      // Raw XML body: the text parser ran BEFORE json, so req.body is the string
      // and the raw bytes are not kept -- HMAC over the string form. Google
      // signs bytes; string HMAC matches for UTF-8 XML without BOM.
      const raw = typeof req.body === 'string' ? req.body : '';
      const want = 'sha1=' + crypto.createHmac('sha1', secret).update(raw, 'utf8').digest('hex');
      let okSig = false;
      try { okSig = sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)); } catch {}
      if (!okSig) {
        logger.warn('[publisher/youtube] forged push rejected (bad signature)');
        return;
      }
    }
    const xml = typeof req.body === 'string' ? req.body : '';
    if (!xml.includes('<entry')) return;
    const feed = atomParser.parse(xml);
    const raw = feed?.feed?.entry;
    const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const feedChannel = String(feed?.feed?.['yt:channelId'] || '');
    const { normalize } = require('./sources/youtube');
    for (const en of entries.slice(0, 5)) {
      const videoId = String(en?.['yt:videoId'] || '').trim();
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      const ev = normalize({
        id: videoId,
        title: typeof en.title === 'string' ? en.title : videoId,
        author: typeof en?.author?.name === 'string' ? en.author.name : '',
        date: en.published || en.updated || '',
        channelId: feedChannel,
      });
      if (!ev) continue;
      const r = await ctx.pipeline.ingest(ev);
      if (r.ok) logger.info(`[publisher/youtube] PubSub ingested ${videoId}`);
    }
    await persist();
  } catch (e) { logger.warn('[publisher/youtube] notify failed:', e.message); }
}

async function subscribeYouTube() {
  const cfg = ctx.config;
  const base = (cfg?.webhook?.publicBase || '').replace(/\/$/, '');
  const channels = (cfg?.reposter?.youtube || []).map((x) => x.key).filter(Boolean);
  if (!base || !channels.length) {
    logger.info('[publisher/youtube] PubSub skipped (no WEBHOOK_PUBLIC_BASE or YOUTUBE_MAP)');
    return;
  }
  const axios = require('axios');
  const secret = cfg?.webhook?.secret || '';
  const run = async () => {
    for (const ytId of channels) {
      try {
        const form = {
          'hub.callback': `${base}/hook/youtube`,
          'hub.mode': 'subscribe',
          'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${ytId}`,
          'hub.verify': 'async',
          'hub.lease_seconds': '432000',
        };
        // Authenticated pushes: hub.secret makes Google sign POSTs with
        // X-Hub-Signature (HMAC-SHA1), verified in ytNotify. Without a secret
        // anyone knowing callback+channel_id could forge entries.
        if (secret) form['hub.secret'] = secret;
        await axios.post('https://pubsubhubbub.appspot.com/subscribe',
          new URLSearchParams(form).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
        logger.info(`[publisher/youtube] PubSub subscribed ${ytId}`);
      } catch (e) { logger.warn(`[publisher/youtube] sub failed ${ytId}: ${e.message}`); }
    }
  };
  await run().catch(() => {});
  if (subTimer) clearInterval(subTimer);
  subTimer = setInterval(() => run().catch(() => {}), 4 * 24 * 3600 * 1000);
  subTimer.unref?.();
}

// --- Twitch EventSub ---------------------------------------------------------
async function twitchNotify(req, res) {
  const msgType = String(req.headers['twitch-eventsub-message-type'] || '').toLowerCase();
  if (msgType === 'webhook_callback_verification') {
    logger.info('[publisher/twitch] EventSub challenge accepted');
    return res.status(200).send(String(req.body?.challenge || ''));
  }
  if (msgType === 'revocation') {
    logger.warn('[publisher/twitch] subscription revoked:', req.body?.subscription?.type);
    return res.status(200).send('ok');
  }
  const secret = ctx.config?.publisher?.twitch?.eventsubSecret || '';
  if (!verifySignature(secret, req.headers, req.rawBody || '')) {
    logger.warn('[publisher/twitch] invalid signature, rejected');
    return res.status(403).send('bad signature');
  }
  res.status(200).send('ok'); // ack fast
  try {
    const { isSourceOn } = require('./source-state');
    const subType = req.body?.subscription?.type;
    if (!isSourceOn('twitch') && (subType === 'stream.online' || subType === 'stream.offline')) {
      logger.info('[publisher/twitch] event ignored (source disabled)');
      return;
    }
    const event = req.body?.event || {};
    if (subType === 'stream.online') {
      const ev = normalizeOnline(event, ctx.config);
      if (!ev) return;
      logger.info(`[publisher/twitch] stream.online ${ev.id}`);
      await handleLiveOnline('twitch', { streamId: ev.id, url: ev.url }, ev);
    } else if (subType === 'stream.offline') {
      logger.info('[publisher/twitch] stream.offline');
      await handleLiveOffline('twitch');
    }
  } catch (e) { logger.warn('[publisher/twitch] notify failed:', e.message); }
}

// --- shared secret check (body.secret / headers / Bearer) --------------------
function webhookToken(req) {
  const hdr = req.headers || {};
  const auth = String(hdr.authorization || '');
  return req.body?.secret
    || hdr['x-hpsb-secret']
    || hdr['x-webhook-secret']
    || hdr['x-api-key']
    || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null);
}

function checkSecret(req, res) {
  const secret = ctx.config?.webhook?.secret || '';
  if (secret && webhookToken(req) !== secret) {
    res.status(401).json({ ok: false, error: 'bad secret' });
    return false;
  }
  return true;
}

// --- /hook/hpsb + /hook/instagram + legacy /hook/news --------------------------
async function hpsbHook(req, res) {
  if (!checkSecret(req, res)) return;
  try {
    if (!require('./source-state').isSourceOn('hpsb')) {
      return res.status(503).json({ ok: false, error: 'hpsb source disabled' });
    }
  } catch {}
  const b = req.body || {};
  const type = String(b.type || '').toLowerCase();
  if (!['release', 'event', 'news'].includes(type) || !b.id) {
    return res.status(400).json({ ok: false, error: 'type=release|event|news + id required' });
  }
  const ev = {
    source: 'hpsb', type,
    id: String(b.id),
    author: b.author || b.artist || 'HPSB',
    title: b.title || 'Untitled',
    description: b.description || '',
    url: b.url || '',
    image: b.image || '',
    publishedAt: b.publishedAt || new Date().toISOString(),
    target: 'announcements',
    metadata: b.metadata && typeof b.metadata === 'object' ? b.metadata : {},
  };
  const r = await ctx.pipeline.ingest(ev);
  await persist();
  res.json({ ok: true, deduped: !r.ok });
}

async function instagramHook(req, res) {
  const igSecret = ctx.config?.publisher?.instagram?.webhookSecret || '';
  const globalSecret = ctx.config?.webhook?.secret || '';
  // Accept EITHER secret: Meta handshake uses the IG one, legacy flows the
  // global one. Requiring different secrets at different stages bricks setup.
  if (igSecret || globalSecret) {
    const got = req.query['hub.verify_token'] || webhookToken(req);
    if (got !== igSecret && got !== globalSecret) {
      return res.status(403).send('bad secret');
    }
  }
  // Meta verification handshake (secret already validated above).
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.challenge']) {
    return res.status(200).send(String(req.query['hub.challenge']));
  }
  try {
    if (!require('./source-state').isSourceOn('instagram')) {
      return res.status(503).json({ ok: false, error: 'instagram source disabled' });
    }
  } catch {}
  const bodies = Array.isArray(req.body?.entry) ? req.body.entry : [req.body || {}];
  let ingested = 0;
  for (const b of bodies) {
    const ev = normalizeIg(b);
    if (!ev) continue;
    const r = await ctx.pipeline.ingest(ev);
    if (r.ok) ingested++;
  }
  await persist();
  res.json({ ok: true, ingested });
}

async function legacyNewsHook(req, res) {
  if (!checkSecret(req, res)) return;
  const { title, description, url, image, source } = req.body || {};
  if (!title || !description) return res.status(400).json({ ok: false, error: 'title+description required' });
  const stableId = String(
    req.body.videoId || req.body.media_id || req.body.id
    || url
    || `${String(source || 'legacy').toLowerCase()}:${String(title).slice(0, 120)}`,
  );
  const s = String(source || '').toLowerCase();
  // Legacy route respects source toggles like the native ones (findings: it bypassed them).
  const family = s.includes('youtube') ? 'youtube' : s.includes('instagram') ? 'instagram' : s.includes('tiktok') ? 'tiktok' : 'hpsb';
  try {
    if (!require('./source-state').isSourceOn(family)) {
      return res.status(503).json({ ok: false, error: `${family} source disabled` });
    }
  } catch {}
  // Stable id: same payload delivered twice must dedupe (never Date.now()).
  let ev;
  if (s.includes('youtube')) {
    ev = { source: 'youtube', type: 'video', id: stableId, author: '', title, description, url, image, publishedAt: new Date().toISOString(), target: 'media', metadata: {} };
  } else if (s.includes('instagram')) {
    ev = normalizeIg({ ...req.body, type: 'post', id: req.body.videoId || req.body.media_id || req.body.id || undefined });
  } else if (s.includes('tiktok')) {
    ev = { source: 'tiktok', type: 'video', id: stableId, author: String(req.body.username || ''), title, description, url, image, publishedAt: new Date().toISOString(), target: 'media', metadata: {} };
  } else {
    ev = { source: 'hpsb', type: 'news', id: stableId, author: 'HPSB', title, description, url, image, publishedAt: new Date().toISOString(), target: 'announcements', metadata: { legacy: true } };
  }
  if (!ev) return res.status(400).json({ ok: false, error: 'unusable payload' });
  const r = await ctx.pipeline.ingest(ev);
  await persist();
  res.json({ ok: true, deduped: !r.ok });
}

// --- server -------------------------------------------------------------------
function guardDisabled(req, res, next) {
  if (!publisherEnabled()) return res.status(503).json({ ok: false, error: 'publisher disabled' });
  next();
}

async function start(client, pipeline, config, liveApi) {
  await stop().catch(() => {});
  ctx = { client, pipeline, config, getLive: liveApi.get, setLive: liveApi.set };
  const { port, secret, channelId } = config?.webhook || {};
  const app = express();

  // Capture raw body for Twitch HMAC (JSON parsed + raw kept).
  app.use(express.json({
    limit: '512kb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));

  app.get('/health', (_req, res) => res.json({ ok: true, publisher: publisherEnabled() }));

  app.use('/hook/youtube', express.text({ type: '*/*', limit: '512kb' }));
  app.get('/hook/youtube', ytVerify);
  app.post('/hook/youtube', guardDisabled, ytNotify);

  app.post('/hook/twitch', guardDisabled, twitchNotify);
  app.post('/hook/hpsb', guardDisabled, hpsbHook);
  app.post('/hook/instagram', guardDisabled, instagramHook);
  app.post('/hook/news', guardDisabled, legacyNewsHook); // legacy compat

  if (!secret) logger.warn('[publisher/webhook] WEBHOOK_SECRET empty -- anyone can post. Set a secret!');
  if (!channelId) logger.info('[publisher/webhook] no WEBHOOK_NEWS_CHANNEL_ID -- legacy compat posts use routed channels');

  httpServer = app.listen(port || 3100, () => logger.info(`[publisher/webhook] listening :${port || 3100}`));
  // Never process.exit() from a module: a busy port (stale second instance)
  // must not kill the whole bot -- log loudly so it gets noticed instead.
  httpServer.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') {
      logger.error(`[publisher/webhook] port ${port} busy -- another bot instance is already running. Webhooks OFF, polling continues.`);
    } else {
      logger.error('[publisher/webhook] listen failed:', e?.message || e);
    }
  });

  subscribeYouTube().catch((e) => logger.warn('[publisher/youtube] subscribe init failed:', e.message));
  const { subscribe } = require('./sources/twitch');
  try {
    if (require('./source-state').isSourceOn('twitch')) {
      subscribe(config).catch((e) => logger.warn('[publisher/twitch] subscribe init failed:', e.message));
    } else {
      logger.info('[publisher/twitch] EventSub skipped (source disabled)');
    }
  } catch (e) {
    logger.warn('[publisher/twitch] source-state unreadable:', e?.message || e);
  }
  logger.info('[publisher/webhook] routes: /hook/youtube /hook/twitch /hook/instagram /hook/hpsb /hook/news');
}

function stop() {
  if (subTimer) { clearInterval(subTimer); subTimer = null; }
  ctx = null;
  if (httpServer) {
    // Await the actual close: restarting (toggle /publisher) immediately
    // re-listens the same port, and a half-closed socket = EADDRINUSE with
    // webhooks silently OFF.
    const srv = httpServer;
    httpServer = null;
    return new Promise((resolve) => {
      try {
        srv.close(() => {
          logger.info('[publisher/webhook] stopped');
          resolve();
        });
        setTimeout(resolve, 3000).unref?.();
      } catch { resolve(); }
    });
  }
  logger.info('[publisher/webhook] stopped');
  return Promise.resolve();
}

module.exports = { start, stop, handleLiveOnline, handleLiveOffline };
