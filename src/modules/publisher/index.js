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
const { runSync, sourceStatus } = require('./sources/index');

let pipeline = null;
let live = liveMod.blank();

function getLive() { return live; }
function setLive(st) { live = st; }

async function startPublisher(client) {
  const { config } = require('../../config');
  if (pipeline) {
    logger.warn('[publisher] already running, start skipped (no duplicate timers)');
    return;
  }
  pipeline = createPipeline({ client, config, log: logger });
  const st = loadState();
  pipeline.dedup.loadSeen(st.seen);
  logger.info(`[publisher] loaded ${st.seen.length} seen keys (restart reposts: none of these)`);
  live = liveMod.fromStored(st.live);
  pipeline.setLive(live);
  pipeline.start();
  scheduler.start(pipeline, config);
  webhooks.start(client, pipeline, config, { get: getLive, set: setLive });
  logger.info('[publisher] started (pipeline + scheduler + webhooks)');
}

async function stopPublisher() {
  scheduler.stop();
  webhooks.stop();
  if (pipeline) {
    try { pipeline.stop(); } catch {}
    try {
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

module.exports = { manifest, startPublisher, stopPublisher, getPipeline, getLive, runSync, sourceStatus };
