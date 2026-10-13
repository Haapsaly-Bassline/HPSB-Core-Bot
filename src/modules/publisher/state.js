// Publisher persistent state: logically separated slice, never mixed with
// media dedup of other subsystems.
// { seen: [dedupKeys], live: {...}, reminders: {...},
//   posts: { [dedupKey]: { channelId, messageId, hash } } }
// posts maps every published item to its Discord message: sync EDITs in place
// instead of reposting (no spam), and prunes entries whose message was deleted.
const store = require('../../utils/store');
const { logger } = require('../../utils/logger');

const KEY = 'publisher';

function blank() {
  return { seen: [], live: {}, reminders: {}, posts: {} };
}

function cleanPosts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !v || typeof v !== 'object') continue;
    if (typeof v.messageId !== 'string' || !v.messageId) continue;
    out[k] = {
      channelId: typeof v.channelId === 'string' ? v.channelId : '',
      messageId: v.messageId,
      hash: typeof v.hash === 'string' ? v.hash : '',
    };
  }
  return out;
}

function loadState() {
  try {
    const d = store.load();
    const p = d[KEY] && typeof d[KEY] === 'object' ? d[KEY] : {};
    return {
      seen: Array.isArray(p.seen) ? p.seen.filter(k => typeof k === 'string') : [],
      live: p.live && typeof p.live === 'object' ? p.live : {},
      reminders: p.reminders && typeof p.reminders === 'object' ? p.reminders : {},
      posts: cleanPosts(p.posts),
    };
  } catch {
    return blank();
  }
}

async function saveState(patch) {
  try {
    await store.exclusive(async () => {
      const d = store.load();
      d[KEY] = { ...blank(), ...(d[KEY] || {}), ...patch };
      if (!Array.isArray(d[KEY].seen)) d[KEY].seen = [];
      d[KEY].posts = cleanPosts(d[KEY].posts);
      store.save(d);
    });
  } catch (e) {
    // NEVER swallow: an unwritable store = reposts on every restart.
    logger.warn('[publisher] state save FAILED (dedup will not survive restart):', e?.message || e);
    throw e;
  }
}

// Drop tracked entries pointing at a deleted message (keeps the DB free of
// garbage; seen-memory is untouched so nothing reposts by accident).
// Returns true when something was actually pruned.
async function pruneTrackedMessage(messageId) {
  if (!messageId) return false;
  try {
    let pruned = false;
    await store.exclusive(async () => {
      const d = store.load();
      const posts = d[KEY] && typeof d[KEY] === 'object' ? d[KEY].posts : null;
      if (!posts || typeof posts !== 'object') return;
      for (const [k, v] of Object.entries(posts)) {
        if (v && v.messageId === messageId) {
          delete posts[k];
          pruned = true;
        }
      }
      if (pruned) store.save(d);
    });
    return pruned;
  } catch {
    return false;
  }
}

module.exports = { loadState, saveState, blank, KEY, cleanPosts, pruneTrackedMessage };
