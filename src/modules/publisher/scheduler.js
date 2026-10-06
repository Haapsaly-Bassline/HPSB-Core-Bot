// Publisher scheduler: polling fallback timers.
// Two loops: HPSB feeds (releases/events/news + reminders) and media (YT/TT).
// Disabled/unconfigured sources get NO timer. One source failing never stops
// the others. PubSub/EventSub/webhooks stay the primary path -- polling is backup.
const { logger } = require('../../utils/logger');
const { runSync, dueReminders } = require('./sources/index');
const { resolveChannel, pingFor } = require('./router');
const { saveState } = require('./state');

let hpsbTimer = null;
let mediaTimer = null;
let liveTimer = null;
let running = false;
let hpsbBusy = false;
let mediaBusy = false;
let liveBusy = false;

function srcEnabled(cfg, key) {
  try {
    return require('./source-state').isSourceOn(key);
  } catch {
    return cfg?.publisher?.sources?.[key] !== false;
  }
}

function minutes(v, def, min) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : def;
}

async function runHpsb(pipeline, cfg, opts = {}) {
  if (hpsbBusy) { logger.warn('[publisher/hpsb] previous pass still active, skipping'); return; }
  hpsbBusy = true;
  try {
    const res = await runSync(pipeline, cfg, { sources: 'hpsb', ...opts });
    for (const [k, r] of Object.entries(res)) {
      if (r.posted) logger.info(`[publisher/hpsb] poll ${k}: found ${r.found}, posted ${r.posted}`);
      else if (r.note) logger.info(`[publisher/hpsb] poll ${k}: found ${r.found} (${r.note.slice(0, 160)})`);
      else if (opts.baseline && r.found) logger.info(`[publisher/hpsb] baseline ${k}: remembered ${r.found}, posted 0`);
    }
  } catch (e) { logger.warn('[publisher/hpsb] poll failed:', e.message); }
  finally { hpsbBusy = false; }
  if (!opts.baseline) {
    await runReminders(pipeline, cfg).catch((e) => logger.warn('[publisher/hpsb] reminders failed:', e.message));
  }
}

async function runReminders(pipeline, cfg) {
  if (!srcEnabled(cfg, 'hpsb')) return;
  const channelId = resolveChannel('announcements', cfg);
  if (!channelId) return;
  const { fetchEvents } = require('./sources/hpsb');
  const { loadState } = require('./state');
  const { events } = await fetchEvents(cfg).catch(() => ({ events: [] }));
  if (!events.length) return;
  const st = loadState();
  st.reminders = st.reminders && typeof st.reminders === 'object' ? st.reminders : {};
  const { due, noStart } = dueReminders(events, st.reminders);
  if (noStart) logger.info(`[publisher/hpsb] ${noStart} event(s) without start field -- reminders skipped`);
  const ping = pingFor('announcements', cfg);
  let posted = 0;
  for (const { ev, tier } of due) {
    const remindKey = `hpsb:event:${ev.id}#remind-${tier}`;
    // Crash recovery: worker may have posted+committed the reminder while the
    // reminders map below never got saved -- then reserve() reports duplicate.
    // Treat "already published" as done instead of retrying forever.
    if (pipeline.dedup.published.has(remindKey)) {
      if (!(st.reminders[ev.id] || []).includes(tier)) (st.reminders[ev.id] = st.reminders[ev.id] || []).push(tier);
      continue;
    }
    const r = await pipeline.ingest({ ...ev, id: `${ev.id}#remind-${tier}`, metadata: { ...(ev.metadata || {}), reminderTier: tier } });
    if (!r.ok) continue;
    await pipeline.queue.onIdle();
    if (pipeline.dedup.published.has(r.key)) {
      (st.reminders[ev.id] = st.reminders[ev.id] || []).push(tier);
      posted++;
    }
  }
  if (posted) {
    logger.info(`[publisher/hpsb] reminders posted: ${posted}`);
    await saveState({ seen: pipeline.dedup.dumpSeen(), reminders: st.reminders });
  }
}

async function runMedia(pipeline, cfg, opts = {}) {
  if (mediaBusy) { logger.warn('[publisher/media] previous pass still active, skipping'); return; }
  mediaBusy = true;
  try {
    const res = await runSync(pipeline, cfg, { sources: 'media', ...opts });
    for (const [k, r] of Object.entries(res)) {
      if (r.posted) logger.info(`[publisher/${k}] poll: found ${r.found}, posted ${r.posted}`);
      else if (r.note) logger.info(`[publisher/${k}] poll: found ${r.found} (${r.note.slice(0, 160)})`);
      else if (opts.baseline && r.found) logger.info(`[publisher/${k}] baseline: remembered ${r.found}, posted 0`);
    }
  } catch (e) { logger.warn('[publisher/media] poll failed:', e.message); }
  finally { mediaBusy = false; }
}

// --- YouTube live watch (multistream): Twitch EventSub pushes, YouTube is
// polled on a short loop. Offline fires only after 2 consecutive misses so a
// single failed check can't end the stream message by accident.
const liveMisses = new Map(); // channelId -> consecutive not-live count

async function pollLive(pipeline, cfg, deps = {}) {
  if (!srcEnabled(cfg, 'youtube')) return;
  if (liveBusy) { logger.warn('[publisher/live] previous check still active, skipping'); return; }
  liveBusy = true;
  try {
    const channels = cfg?.reposter?.youtube || [];
    if (!channels.length) return;
    const { checkYoutubeLive } = require('./sources/youtube-live');
    const states = await checkYoutubeLive({ channels, apiKey: cfg?.reposter?.youtubeApiKey, http: deps.http });
    const wh = () => require('./webhooks');
    const onOnline = deps.onOnline || ((ref, ev) => wh().handleLiveOnline('youtube', ref, ev));
    const onOffline = deps.onOffline || ((ev) => wh().handleLiveOffline('youtube', ev));
    const liveNow = (() => { try { return pipeline.getLive?.()?.youtube || null; } catch { return null; } })();
    for (const st of states) {
      if (st.live && st.videoId) {
        liveMisses.delete(st.channelId);
        const ev = {
          source: 'youtube', type: 'live', id: st.videoId,
          author: st.author || 'HPSB', title: st.title || 'Live',
          description: '', url: st.url,
          image: `https://i.ytimg.com/vi/${st.videoId}/hqdefault.jpg`,
          publishedAt: new Date().toISOString(),
          target: 'announcements', metadata: { channelId: st.channelId },
        };
        logger.info(`[publisher/live] youtube live: ${st.videoId}`);
        await onOnline({ videoId: st.videoId, url: st.url }, ev);
      } else {
        if (!liveNow?.live) { liveMisses.delete(st.channelId); continue; }
        const n = (liveMisses.get(st.channelId) || 0) + 1;
        if (n < 2) { liveMisses.set(st.channelId, n); continue; }
        liveMisses.delete(st.channelId);
        logger.info('[publisher/live] youtube ended');
        await onOffline();
      }
    }
  } catch (e) {
    logger.warn('[publisher/live] check failed:', e?.message || e);
  } finally {
    liveBusy = false;
  }
}

function _clearLiveMisses() { liveMisses.clear(); }

function start(pipeline, cfg) {
  stop();
  running = true;
  hpsbBusy = false;
  mediaBusy = false;
  liveBusy = false;
  const hpsbOn = srcEnabled(cfg, 'hpsb');
  const mediaOn = srcEnabled(cfg, 'youtube') || srcEnabled(cfg, 'tiktok');
  const liveOn = srcEnabled(cfg, 'youtube');

  if (hpsbOn) {
    const mins = minutes(cfg?.hpsb?.pollMinutes, 5, 1);
    // Boot baseline: remember everything WITHOUT posting (a restart must never
    // re-post history; catch-up after downtime = /sync backfill/republish).
    runHpsb(pipeline, cfg, { baseline: true })
      .then(() => logger.info('[publisher/hpsb] boot baseline remembered'))
      .catch(() => {});
    hpsbTimer = setInterval(() => { if (running) runHpsb(pipeline, cfg).catch(() => {}); }, mins * 60 * 1000);
    hpsbTimer.unref?.();
    logger.info(`[publisher/hpsb] polling every ${mins}m`);
  } else {
    logger.info('[publisher/hpsb] disabled');
  }

  if (mediaOn) {
    const mins = minutes(cfg?.reposter?.pollMinutes, 10, 2);
    runMedia(pipeline, cfg, { baseline: true })
      .then(() => logger.info('[publisher/media] boot baseline remembered'))
      .catch(() => {});
    mediaTimer = setInterval(() => { if (running) runMedia(pipeline, cfg).catch(() => {}); }, mins * 60 * 1000);
    mediaTimer.unref?.();
    logger.info(`[publisher/media] polling every ${mins}m`);
  } else {
    logger.info('[publisher/media] disabled');
  }

  if (liveOn) {
    const mins = minutes(cfg?.publisher?.live?.checkMinutes, 2, 1);
    pollLive(pipeline, cfg).catch(() => {});
    liveTimer = setInterval(() => { if (running) pollLive(pipeline, cfg).catch(() => {}); }, mins * 60 * 1000);
    liveTimer.unref?.();
    logger.info(`[publisher/live] youtube live check every ${mins}m`);
  } else {
    logger.info('[publisher/live] disabled');
  }

  // runReminders ingests through the pipeline (formatter picks the reminder variant).
}

function stop() {
  running = false;
  if (hpsbTimer) { clearInterval(hpsbTimer); hpsbTimer = null; }
  if (mediaTimer) { clearInterval(mediaTimer); mediaTimer = null; }
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  logger.info('[publisher] scheduler stopped');
}

module.exports = { start, stop, runHpsb, runMedia, runReminders, pollLive, _clearLiveMisses };
