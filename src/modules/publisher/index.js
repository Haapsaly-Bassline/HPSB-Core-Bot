// New Publisher: single pipeline for all publishing.
//   sources/*  -> normalize -> dedup -> queue -> router -> formatter -> Discord
// Wired into the Module Manager (replaces legacy reposter/site-publisher).
// Legacy dirs stay on disk for reference but are NOT imported at runtime.
const { logger } = require('../../utils/logger');
const { createPipeline } = require('./pipeline');
const { loadState, saveState } = require('./state');
const liveMod = require('./live');
const scheduler = require('./scheduler');
const webhooks = require('./webhooks');
const { runSync } = require('./sources/index');
const { effectiveSources } = require('./source-state');

let pipeline = null;
let live = liveMod.blank();

function getLive() { return live; }
function setLive(st) { live = st; }

// Config with effective source flags (Discord overrides applied on top of .env).
// Anything reading sources must use this, never raw config, or toggles leak.
function effectiveConfig() {
  const { config } = require('../../config');
  return {
    ...config,
    publisher: { ...config.publisher, sources: effectiveSources() },
  };
}

// Status rows for /modules and /health (effective states). Never throws.
function sourceStatus() {
  const { sourceStatus: base } = require('./sources/index');
  try {
    return base(effectiveConfig());
  } catch {
    return [];
  }
}

async function startPublisher(client) {
  if (pipeline) {
    logger.warn('[publisher] already running, start skipped (no duplicate timers)');
    return;
  }
  const eff = effectiveConfig();
  pipeline = createPipeline({ client, config: eff, log: logger });
  const st = loadState();
  pipeline.dedup.loadSeen(st.seen);
  logger.info(`[publisher] loaded ${st.seen.length} seen keys (restart reposts: none of these)`);
  live = liveMod.fromStored(st.live);
  pipeline.setLive(live);
  pipeline.start();
  scheduler.start(pipeline, eff);
  if (eff.webhook?.enabled !== false) {
    webhooks.start(client, pipeline, eff, { get: getLive, set: setLive });
  } else {
    logger.info('[publisher] webhooks disabled (WEBHOOK_ENABLED=off) -- polling only, no EventSub/PubSub');
  }
  logger.info('[publisher] started (pipeline + scheduler + webhooks)');
}

async function stopPublisher() {
  scheduler.stop();
  try { await webhooks.stop(); } catch {}
  if (pipeline) {
    try { pipeline.stop(); } catch {}
    try {
      // Drain: an in-flight worker may commit AFTER the snapshot otherwise,
      // losing the key and reposting it after restart.
      await Promise.race([
        pipeline.queue.onIdle(),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      await saveState({ seen: pipeline.dedup.dumpSeen(), live: getLive() || {} });
    } catch {}
    pipeline = null;
  }
  logger.info('[publisher] stopped (timers + listeners released)');
}

function getPipeline() { return pipeline; }

function manifest() {
  return { name: 'publisher', label: 'Publisher', dependsOn: [], start: startPublisher, stop: stopPublisher };
}

module.exports = { manifest, startPublisher, stopPublisher, getPipeline, getLive, runSync, sourceStatus, effectiveConfig };
