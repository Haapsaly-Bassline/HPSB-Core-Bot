// Channel reconciliation: what is ACTUALLY in the Discord channel right now.
// Seen-memory says "posted", but channels get recreated/wiped -- after that the
// only truth is channel history. Used by /sync mode=missing.
const URL_RE = /https?:\/\/[^\s<>()]+/gi;

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
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch?.isTextBased()) return { urls, blob, ok: false };
    const msgs = await ch.messages.fetch({ limit: Math.min(Math.max(limit, 1), 100) }).catch(() => null);
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

module.exports = { scanChannel, isPresent, messageText };
