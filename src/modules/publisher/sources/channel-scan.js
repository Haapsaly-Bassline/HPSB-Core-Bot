// Channel reconciliation: what is ACTUALLY in the Discord channel right now.
// Seen-memory says "posted", but channels get recreated/wiped -- after that the
// only truth is channel history. Used by /sync mode=missing.
const { withTimeout } = require('../../../utils/timeout');
const URL_RE = /https?:\/\/[^\s<>()]+/gi;

const SCAN_FETCH_TIMEOUT_MS = 15000;
const SCAN_MSGS_TIMEOUT_MS = 30000;

function messageText(m) {
  const parts = [];
  if (m.content) parts.push(m.content);
  for (const e of m.embeds || []) {
    const d = typeof e.toJSON === 'function' ? e.toJSON() : e;
    if (d.url) parts.push(d.url);
    if (d.title) parts.push(d.title);
    if (d.description) parts.push(d.description);
  }
  // Buttons live on the message, not on each embed -- scan once.
  for (const row of m.components || []) {
    for (const b of row.components || []) {
      if (b.url) parts.push(b.url);
    }
  }
  return parts.join('\n');
}

// Fetch recent history of a channel -> { urls:Set, blob:string, ok }.
// ok=false when history is unreadable (no channel/access) -- callers must NOT
// treat everything as missing then (that would repost up to 25 items blindly).
async function scanChannel(client, channelId, limit = 100) {
  const urls = new Set();
  let blob = '';
  try {
    if (!channelId) return { urls, blob, ok: false };
    // Timeout-guarded: a stalled Discord API call here used to wedge the
    // whole /sync loop forever (one post out, then silence, zero errors).
    const ch = await withTimeout(
      client.channels.fetch(channelId).catch(() => null),
      SCAN_FETCH_TIMEOUT_MS, 'scan channel fetch').catch(() => null);
    if (!ch?.isTextBased()) return { urls, blob, ok: false };
    const msgs = await withTimeout(
      ch.messages.fetch({ limit: Math.min(Math.max(limit, 1), 100) }),
      SCAN_MSGS_TIMEOUT_MS, 'scan history fetch').catch(() => null);
    if (!msgs) return { urls, blob, ok: false };
    const list = typeof msgs.values === 'function' ? [...msgs.values()] : msgs;
    for (const m of list) {
      const t = messageText(m || {});
      if (!t) continue;
      blob += '\n' + t;
      for (const u of t.match(URL_RE) || []) {
        try { urls.add(new URL(u).href); } catch { urls.add(u); }
      }
    }
  } catch { return { urls, blob, ok: false }; }
  return { urls, blob, ok: true };
}

function normUrl(u) {
  try { return new URL(String(u || '')).href; } catch { return String(u || ''); }
}

// True when the event is verifiably already posted in the scanned channel.
// URL match is exact; id-substring match only counts for long ids (short
// numeric/slug ids collide with random message text and would wrongly skip
// a restore).
function isPresent(ev, scan) {
  if (!ev) return false;
  if (ev.url && scan.urls.has(normUrl(ev.url))) return true;
  const id = String(ev.id || '');
  if (id.length >= 8 && scan.blob.includes(id)) return true;
  return false;
}

// Fetch one tracked message: hit (exists) | gone (deleted: 404/10008) |
// unknown (no access, timeout, no channel -- caller must NOT treat as gone,
// otherwise a permission outage mass-deletes tracking AND reposts).
async function fetchTrackedMessage(client, chCache, mapping) {
  try {
    if (!mapping?.messageId) return { status: 'unknown' };
    let ch;
    if (chCache.has(mapping.channelId)) {
      ch = chCache.get(mapping.channelId);
    } else {
      ch = await withTimeout(
        client.channels.fetch(mapping.channelId).catch(() => null),
        15000, 'channel fetch');
      chCache.set(mapping.channelId, ch || false);
    }
    if (!ch || ch === false || !ch.isTextBased?.()) return { status: 'unknown' };
    try {
      const msg = await withTimeout(
        ch.messages.fetch(mapping.messageId), 15000, 'message fetch');
      return msg ? { status: 'hit', msg } : { status: 'unknown' };
    } catch (e) {
      if (e?.code === 10008) return { status: 'gone' };
      return { status: 'unknown' };
    }
  } catch {
    return { status: 'unknown' };
  }
}

module.exports = { scanChannel, isPresent, messageText, fetchTrackedMessage };
