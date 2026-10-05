// New Publisher: single pipeline for all publishing (sources -> normalize ->
// dedup -> queue -> router -> formatter -> Discord). NOT wired into the Module
// Manager yet -- legacy reposter/site-publisher still run production traffic
// until the switch phase (then this manifest replaces the legacy entry).
const { logger } = require('../../utils/logger');
const { createPipeline } = require('./pipeline');
const { loadState, saveState } = require('./state');
const liveMod = require('./live');

let pipeline = null;

async function startPublisher(client) {
  const { config } = require('../../config');
  pipeline = createPipeline({ client, config, log: logger });
  const st = loadState();
  pipeline.dedup.loadSeen(st.seen);
  pipeline.setLive(liveMod.fromStored(st.live));
  pipeline.start();
  logger.info('[module] publisher (new) started');
}

async function stopPublisher() {
  if (pipeline) {
    try { pipeline.stop(); } catch {}
    try {
      await saveState({ seen: pipeline.dedup.dumpSeen(), live: pipeline.getLive() || {} });
    } catch {}
    pipeline = null;
  }
  logger.info('[module] publisher (new) stopped');
}

function manifest() {
  return { name: 'publisher', label: 'Publisher', dependsOn: [], start: startPublisher, stop: stopPublisher };
}

module.exports = { manifest, startPublisher, stopPublisher, getPipeline: () => pipeline };
