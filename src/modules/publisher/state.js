// Publisher persistent state: logically separated slice, never mixed with
// media dedup of other subsystems. { seen: [dedupKeys], live: {...}, reminders: {...} }
const store = require('../../utils/store');
const { logger } = require('../../utils/logger');

const KEY = 'publisher';

function blank() {
  return { seen: [], live: {}, reminders: {} };
}

function loadState() {
  try {
    const d = store.load();
    const p = d[KEY] && typeof d[KEY] === 'object' ? d[KEY] : {};
    return {
      seen: Array.isArray(p.seen) ? p.seen.filter(k => typeof k === 'string') : [],
      live: p.live && typeof p.live === 'object' ? p.live : {},
      reminders: p.reminders && typeof p.reminders === 'object' ? p.reminders : {},
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
      store.save(d);
    });
  } catch (e) {
    // NEVER swallow: an unwritable store = reposts on every restart.
    logger.warn('[publisher] state save FAILED (dedup will not survive restart):', e?.message || e);
    throw e;
  }
}

module.exports = { loadState, saveState, blank, KEY };
