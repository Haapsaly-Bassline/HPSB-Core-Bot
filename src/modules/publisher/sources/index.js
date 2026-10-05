// Source registry: one entry per Publisher source.
// Each source: { key, label, emoji, enabled(cfg), configured(cfg), fetch(cfg, opts) }.
// fetch() returns normalized events sorted OLDEST-FIRST (sync republishes
// oldest -> newest; scheduler ingests in the same order so Discord reads chronologically).
// runSync() is shared by /sync and the scheduler: fetch -> pick targets ->
// ingest through pipeline -> await idle -> count posted via dedup.
const { logger } = require('../../../utils/logger');
const { fetchYouTube } = require('./youtube');
const { fetchTikTok } = require('./tiktok');
const { availability: igAvailability } = require('./instagram');
const { fetchHpsb, dueReminders } = require('./hpsb');
const { availability: twAvailability } = require('./twitch');

function srcOn(cfg, key) {
  return cfg?.publisher?.sources?.[key] !== false;
}

function ytChannels(cfg) {
  return cfg?.reposter?.youtube || [];
}

function ttAccounts(cfg) {
  return cfg?.reposter?.tiktok || [];
}

const SOURCES = [
  {
    key: 'releases', label: 'Releases', emoji: '💿', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.releases?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => (await fetchHpsb(cfg, opts)).releases,
  },
  {
    key: 'events', label: 'Events', emoji: '📅', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.events?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => (await fetchHpsb(cfg, opts)).events,
  },
  {
    key: 'news', label: 'News', emoji: '📰', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.posts?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => (await fetchHpsb(cfg, opts)).news,
  },
  {
    key: 'youtube', label: 'YouTube', emoji: '▶️', family: 'media',
    enabled: (cfg) => srcOn(cfg, 'youtube'),
    configured: (cfg) => ytChannels(cfg).length > 0,
    fetch: (cfg, opts) => fetchYouTube({
      apiKey: cfg?.reposter?.youtubeApiKey, channels: ytChannels(cfg), http: opts?.http,
    }),
  },
  {
    key: 'tiktok', label: 'TikTok', emoji: '🎵', family: 'media',
    enabled: (cfg) => srcOn(cfg, 'tiktok'),
    configured: (cfg) => ttAccounts(cfg).length > 0,
    fetch: (cfg, opts) => fetchTikTok({ accounts: ttAccounts(cfg), http: opts?.http }),
  },
  {
    key: 'instagram', label: 'Instagram', emoji: '📸', family: 'media',
    enabled: (cfg) => srcOn(cfg, 'instagram'),
    configured: (cfg) => igAvailability(cfg).ok,
    // No polling provider configured: webhook/API-first (see webhooks.js).
    fetch: async () => [],
  },
];

// /sync alias -> source keys. 'hpsb' = all three feeds, 'all' = everything.
const ALIASES = {
  all: null, // null = no filter
  hpsb: ['releases', 'events', 'news'],
  media: ['youtube', 'tiktok', 'instagram'],
  releases: ['releases'],
  events: ['events'],
  news: ['news'],
  youtube: ['youtube'],
  tiktok: ['tiktok'],
  instagram: ['instagram'],
};

function skippedByFilter(opts, key) {
  const sel = opts?.sources;
  if (!sel) return false;
  const keys = ALIASES[sel] === undefined ? [sel] : ALIASES[sel];
  if (keys === null) return false;
  return !keys.includes(key);
}

function keyOfEv(ev) {
  return `${ev?.source || '?'}:${ev?.type || '?'}:${ev?.id || ''}`;
}

function evTime(ev) {
  const v = ev?.publishedAt || ev?.date || '';
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Pick targets from fetched events (all post OLDEST-FIRST):
// - republish > 0: already-known events, oldest-first, cap 25.
// - backfill > 0: N newest by date (catch-up after outage), posted oldest-first.
// - default: unseen only, cap 5 (never spam a channel with full history).
function pickTargets(fetched, published, { backfill = 0, republish = 0 } = {}) {
  const known = published instanceof Set ? published : new Set(published || []);
  const byAge = (a, b) => (evTime(a) - evTime(b));
  if (republish > 0) {
    return [...fetched].sort(byAge)
      .filter((ev) => known.has(keyOfEv(ev)))
      .slice(0, Math.min(republish, 25));
  }
  if (backfill > 0) {
    const newest = [...fetched].sort((a, b) => byAge(b, a)).slice(0, Math.min(backfill, 5));
    return newest.sort(byAge);
  }
  return fetched.filter((ev) => !known.has(keyOfEv(ev))).slice(0, 5);
}

// Run one sync pass over selected sources through a live pipeline.
// Returns { <key>: { found, posted } | { filtered:true } | { disabled:true } | { unavailable } }.
// First run (nothing published yet) only remembers -- no history spam --
// unless backfill/republish explicitly requested.
async function runSync(pipeline, cfg, opts = {}) {
  const out = {};
  // Snapshot ONCE: first run after a fresh start remembers everything silently
  // (no history spam). Re-snapshotting per source would let source #2+ post
  // up to 5 old items each on the very first run.
  const initiallyEmpty = pipeline.dedup.dumpSeen().length === 0 && !opts.republish && !opts.backfill;
  for (const src of SOURCES) {
    if (skippedByFilter(opts, src.key)) { out[src.key] = { found: 0, posted: 0, filtered: true }; continue; }
    if (!src.enabled(cfg)) { out[src.key] = { found: 0, posted: 0, disabled: true }; continue; }
    if (!src.configured(cfg)) { out[src.key] = { found: 0, posted: 0, unavailable: true }; continue; }
    let fetched = [];
    try {
      fetched = (await src.fetch(cfg, opts)) || [];
    } catch (e) {
      logger.warn(`[publisher/${src.key}] fetch failed: ${e.message}`);
      out[src.key] = { found: 0, posted: 0, error: String(e.message || e).slice(0, 120) };
      continue;
    }
    const republish = opts.republish || 0;
    const backfill = opts.backfill || 0;
    if (initiallyEmpty) {
      for (const ev of fetched) {
        const k = pipeline.dedup.reserve(ev);
        if (k) pipeline.dedup.commit(k);
      }
      out[src.key] = { found: fetched.length, posted: 0 };
      continue;
    }
    const published = new Set(pipeline.dedup.dumpSeen());
    const targets = pickTargets(fetched, published, { backfill, republish });
    // Explicit re-post modes bypass the published-guard (in-flight guard stays).
    const force = republish > 0 || backfill > 0;
    let posted = 0;
    for (const ev of targets) {
      const r = await pipeline.ingest(ev, { force });
      if (!r.ok) continue;
      await pipeline.queue.onIdle();
      if (pipeline.dedup.published.has(r.key)) posted++;
    }
    out[src.key] = { found: fetched.length, posted };
  }
  try {
    const { saveState } = require('../state');
    await saveState({ seen: pipeline.dedup.dumpSeen() });
  } catch {}
  return out;
}

// Status rows for /modules and /health. Never throws.
function sourceStatus(cfg) {
  return SOURCES.map((src) => {
    const on = src.enabled(cfg);
    const cfgd = src.configured(cfg);
    return {
      key: src.key, label: src.label, emoji: src.emoji,
      enabled: on, configured: cfgd,
      state: !on ? 'disabled' : !cfgd ? 'unavailable' : 'on',
    };
  });
}

module.exports = {
  SOURCES, ALIASES, skippedByFilter, pickTargets, keyOfEv,
  runSync, sourceStatus, dueReminders, twAvailability, igAvailability,
};
