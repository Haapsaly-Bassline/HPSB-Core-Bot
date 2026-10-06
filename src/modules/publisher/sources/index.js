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
const { scanChannel, isPresent } = require('./channel-scan');
const { resolveChannel } = require('../router');
const { loadOverrides } = require('../source-state');

function srcOn(cfg, key) {
  // Priority: persistent Discord override > passed config (.env) > default on.
  // (isSourceOn() without cfg is the prod shortcut with the same order.)
  let ov;
  try { ov = loadOverrides()[key]; } catch { ov = undefined; }
  if (ov === true || ov === false) return ov;
  return cfg?.publisher?.sources?.[key] !== false;
}

function ytChannels(cfg) {
  return cfg?.reposter?.youtube || [];
}

function ttAccounts(cfg) {
  return cfg?.reposter?.tiktok || [];
}

// Each fetch returns { events (oldest-first), note } -- note explains an empty
// result (blocked transport, rate limit) so /sync shows WHY, not just 0.
const SOURCES = [
  {
    key: 'releases', label: 'Releases', emoji: '💿', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.releases?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => {
      const r = await fetchHpsb(cfg, opts);
      return { events: r.releases, via: r.via.releases, note: r.notes.releases };
    },
  },
  {
    key: 'events', label: 'Events', emoji: '📅', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.events?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => {
      const r = await fetchHpsb(cfg, opts);
      return { events: r.events, via: r.via.events, note: r.notes.events };
    },
  },
  {
    key: 'news', label: 'News', emoji: '📰', family: 'hpsb',
    enabled: (cfg) => srcOn(cfg, 'hpsb'),
    configured: (cfg) => !!(cfg?.hpsb?.posts?.channelId || cfg?.publisher?.announcementsChannelId),
    fetch: async (cfg, opts) => {
      const r = await fetchHpsb(cfg, opts);
      return { events: r.news, via: r.via.news, note: r.notes.news };
    },
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
    key: 'twitch', label: 'Twitch', emoji: '🟣', family: 'live',
    enabled: (cfg) => srcOn(cfg, 'twitch'),
    configured: (cfg) => twAvailability(cfg).ok,
    // EventSub push only: nothing to poll. The entry exists so the toggle,
    // /modules status and /sync visibility cover Twitch like every source.
    fetch: async () => ({ events: [], via: 'push', note: 'EventSub push only -- nothing to poll' }),
  },
  {
    key: 'instagram', label: 'Instagram', emoji: '📸', family: 'media',
    enabled: (cfg) => srcOn(cfg, 'instagram'),
    configured: (cfg) => igAvailability(cfg).ok,
    // No polling provider configured: webhook/API-first (see webhooks.js).
    fetch: async () => ({ events: [], note: '' }),
  },
];

// /sync alias -> source keys. 'hpsb' = all three feeds, 'all' = everything.
const ALIASES = {
  all: null, // null = no filter
  hpsb: ['releases', 'events', 'news'],
  media: ['youtube', 'tiktok', 'instagram'],
  live: ['twitch'],
  releases: ['releases'],
  events: ['events'],
  news: ['news'],
  youtube: ['youtube'],
  tiktok: ['tiktok'],
  instagram: ['instagram'],
  twitch: ['twitch'],
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
// Returns { <key>: { found, posted, note? } | { filtered:true } | { disabled:true } | { unavailable } }.
// First run (nothing published yet) only remembers -- no history spam --
// unless backfill/republish explicitly requested. `baseline: true` forces the
// remember-only pass (scheduler boot: never post on restart, ever).
// Serialize force-mode runs (republish/backfill/missing): a second concurrent
// force pass would re-post the same events (force bypasses the published
// guard after the first run commits). Normal polls stay parallel-safe via
// dedup reservations.
let forceActive = false;

async function runSync(pipeline, cfg, opts = {}) {
  const out = {};
  const wantForce = (opts.republish || 0) > 0 || (opts.backfill || 0) > 0 || !!opts.missing;
  if (wantForce) {
    if (forceActive) {
      for (const src of SOURCES) {
        if (!skippedByFilter(opts, src.key)) out[src.key] = { found: 0, posted: 0, error: 'another force sync is already running' };
        else out[src.key] = { found: 0, posted: 0, filtered: true };
      }
      return out;
    }
    forceActive = true;
  }
  try {
    return await runSyncInner(pipeline, cfg, opts, out);
  } finally {
    if (wantForce) forceActive = false;
  }
}

async function runSyncInner(pipeline, cfg, opts, out) {
  // Snapshot ONCE: first run after a fresh start remembers everything silently
  // (no history spam). Re-snapshotting per source would let source #2+ post
  // up to 5 old items each on the very first run.
  const initiallyEmpty = pipeline.dedup.dumpSeen().length === 0 && !opts.republish && !opts.backfill;
  const rememberOnly = initiallyEmpty || !!opts.baseline;
  for (const src of SOURCES) {
    if (skippedByFilter(opts, src.key)) { out[src.key] = { found: 0, posted: 0, filtered: true }; continue; }
    if (!src.enabled(cfg)) { out[src.key] = { found: 0, posted: 0, disabled: true }; continue; }
    if (!src.configured(cfg)) { out[src.key] = { found: 0, posted: 0, unavailable: true }; continue; }
    let fetched = [];
    let note = '';
    let via = '';
    try {
      const res = (await src.fetch(cfg, opts)) || {};
      fetched = Array.isArray(res) ? res : (res.events || []);
      note = res.note || '';
      via = res.via || '';
    } catch (e) {
      logger.warn(`[publisher/${src.key}] fetch failed: ${e.message}`);
      out[src.key] = { found: 0, posted: 0, error: String(e.message || e).slice(0, 120) };
      continue;
    }
    const republish = opts.republish || 0;
    const backfill = opts.backfill || 0;
    if (rememberOnly && !republish && !backfill && !opts.missing) {
      for (const ev of fetched) {
        const k = pipeline.dedup.reserve(ev);
        if (k) pipeline.dedup.commit(k);
      }
      out[src.key] = { found: fetched.length, posted: 0, via, note };
      continue;
    }
    // mode=missing: post what is NOT actually in the channel right now
    // (channel was wiped/recreated -- seen-memory alone would skip it all).
    let missingScan = null;
    if (opts.missing && opts.client) {
      if (!opts._scans) opts._scans = {};
      const target = src.family === 'media' ? 'media' : 'announcements';
      if (!opts._scans[target]) {
        opts._scans[target] = await scanChannel(opts.client, resolveChannel(target, cfg));
      }
      missingScan = opts._scans[target];
      if (!missingScan.ok) {
        out[src.key] = { found: fetched.length, posted: 0, error: 'cannot read channel history (need View + Read History)' };
        continue;
      }
    }
    const published = new Set(pipeline.dedup.dumpSeen());
    let targets;
    let force = republish > 0 || backfill > 0;
    if (missingScan) {
      // Shared budget across the whole run: releases+events+news share ONE
      // announcements channel, so per-source caps would spam up to 75 posts.
      const remaining = Math.max(0, (opts._missingBudget ?? Math.min(opts.missingLimit || 25, 25)));
      targets = [...fetched]
        .sort((a, b) => (evTime(a) - evTime(b)))
        .filter((ev) => !isPresent(ev, missingScan))
        .slice(0, remaining);
      opts._missingBudget = remaining - targets.length;
      force = true; // seen-memory may claim these as posted -- channel is the truth
    } else if (opts.missing && !opts.client) {
      out[src.key] = { found: fetched.length, posted: 0, via, note, error: 'missing mode needs channel access (client)' };
      continue;
    } else {
      targets = pickTargets(fetched, published, { backfill, republish });
    }
    let posted = 0;
    for (const ev of targets) {
      const r = await pipeline.ingest(ev, { force });
      if (!r.ok) continue;
      await pipeline.queue.onIdle();
      if (pipeline.dedup.published.has(r.key)) posted++;
    }
    out[src.key] = { found: fetched.length, posted, via, note };
  }
  try {
    const { saveState } = require('../state');
    await saveState({ seen: pipeline.dedup.dumpSeen() });
  } catch (e) {
    logger.warn('[publisher] runSync state save failed:', e?.message || e);
  }
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
