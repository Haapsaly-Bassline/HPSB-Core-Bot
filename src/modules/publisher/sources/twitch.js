// Twitch source: EventSub push (polling is not offered -- Helix polling
// without a subscription burns quota and duplicates live state).
// Security: every POST is HMAC-verified, failures get HTTP 403.
const crypto = require('node:crypto');
const axios = require('axios');
const { logger } = require('../../../utils/logger');

const MSG_ID = 'twitch-eventsub-message-id';
const MSG_TS = 'twitch-eventsub-message-timestamp';
const MSG_SIG = 'twitch-eventsub-message-signature';

function verifySignature(secret, headers = {}, rawBody = '') {
  if (!secret) return false;
  const id = headers[MSG_ID] || headers['Twitch-Eventsub-Message-Id'.toLowerCase()];
  const ts = headers[MSG_TS] || headers['Twitch-Eventsub-Message-Timestamp'.toLowerCase()];
  const sig = headers[MSG_SIG] || headers['Twitch-Eventsub-Message-Signature'.toLowerCase()];
  if (!id || !ts || !sig) return false;
  // Reject stale messages (>10 min) to stop replayed stream.online.
  const age = Math.abs(Date.now() - new Date(ts).getTime());
  if (!Number.isFinite(age) || age > 10 * 60 * 1000) return false;
  const hmac = crypto.createHmac('sha256', secret).update(id + ts + rawBody).digest('hex');
  const want = `sha256=${hmac}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig)));
  } catch { return false; }
}

function normalizeOnline(event = {}, cfg = {}) {
  const streamId = String(event.id || '');
  if (!streamId) return null;
  const url = `https://www.twitch.tv/${event.broadcaster_user_login || ''}` || cfg?.publisher?.twitchUrl || '';
  return {
    source: 'twitch',
    type: 'live',
    id: streamId,
    author: event.broadcaster_user_name || 'HPSB',
    title: event.title || 'Stream',
    description: event.category_name ? `Playing ${event.category_name}` : 'The stream is now live.',
    url,
    image: event.thumbnail_url || '',
    publishedAt: event.started_at || new Date().toISOString(),
    target: 'announcements',
    metadata: { streamId, broadcasterId: event.broadcaster_user_id || '' },
  };
}

function availability(cfg = {}) {
  const t = cfg?.publisher?.twitch || {};
  const missing = [];
  if (!t.clientId) missing.push('TWITCH_CLIENT_ID');
  if (!t.clientSecret) missing.push('TWITCH_CLIENT_SECRET');
  if (!t.broadcasterId) missing.push('TWITCH_BROADCASTER_ID');
  if (!t.eventsubSecret) missing.push('TWITCH_EVENTSUB_SECRET');
  if (!cfg?.webhook?.publicBase) missing.push('WEBHOOK_PUBLIC_BASE');
  return missing.length ? { ok: false, missing } : { ok: true };
}

let appToken = null;
async function getAppToken(cfg) {
  if (appToken?.until > Date.now()) return appToken.token;
  const t = cfg?.publisher?.twitch || {};
  const { data } = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: { client_id: t.clientId, client_secret: t.clientSecret, grant_type: 'client_credentials' },
    timeout: 15000,
  });
  appToken = { token: data.access_token, until: Date.now() + (Number(data.expires_in || 3600) - 300) * 1000 };
  return appToken.token;
}

// Subscribe stream.online + stream.offline for the broadcaster.
async function subscribe(cfg) {
  const avail = availability(cfg);
  if (!avail.ok) {
    logger.info(`[publisher/twitch] skipped (${avail.missing.join(', ')} not set)`);
    return false;
  }
  const t = cfg.publisher.twitch;
  const callback = `${cfg.webhook.publicBase.replace(/\/$/, '')}/hook/twitch`;
  const token = await getAppToken(cfg);
  for (const type of ['stream.online', 'stream.offline']) {
    try {
      await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
        type,
        version: '1',
        condition: { broadcaster_user_id: t.broadcasterId },
        transport: { method: 'webhook', callback, secret: t.eventsubSecret },
      }, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': t.clientId, 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      logger.info(`[publisher/twitch] EventSub subscribed: ${type}`);
    } catch (e) {
      logger.warn(`[publisher/twitch] subscribe ${type} failed: ${e.response?.data?.message || e.message}`);
    }
  }
  return true;
}

module.exports = { verifySignature, normalizeOnline, availability, subscribe, MSG_ID, MSG_TS, MSG_SIG };
