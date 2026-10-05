// Module Manager: single lifecycle for all bot subsystems.
// ready.js no longer starts modules one by one -- it calls startAll().
// Priority: persistent runtime override (data.modules) > .env MODULE_* > default on.
// All requires are lazy (inside start fns) to keep startup lean and avoid cycles.
const { logger } = require('../utils/logger');
const { config } = require('../config');
const store = require('../utils/store');

// In-memory mirror of data.modules (store.load() hits disk on every call).
let overridesCache = null;
function loadOverrides() {
  if (overridesCache) return overridesCache;
  try {
    const d = store.load();
    overridesCache = (d.modules && typeof d.modules === 'object') ? { ...d.modules } : {};
  } catch { overridesCache = {}; }
  return overridesCache;
}

function isEnabled(name) {
  const ov = loadOverrides()[name];
  if (ov === true || ov === false) return ov;
  if (config.modules && typeof config.modules[name] === 'boolean') return config.modules[name];
  return true;
}

async function setOverride(name, value) {
  // value: true/false, or null/undefined to reset back to .env
  await store.exclusive(async () => {
    const d = store.load();
    d.modules = (d.modules && typeof d.modules === 'object') ? d.modules : {};
    if (value === null || value === undefined) delete d.modules[name];
    else d.modules[name] = !!value;
    store.save(d);
  });
  overridesCache = null;
  loadOverrides();
}

let musicRetryTimer = null;

async function startMusic(client) {
  if (config.music.engine !== 'lavalink') {
    throw new Error(`MUSIC_ENGINE=${config.music.engine} no longer supported -- legacy removed, set lavalink`);
  }
  const { LavalinkEngine } = require('./music/engine-lavalink');
  let engine = client.music;
  const looksNew = !engine || typeof engine.init !== 'function';
  if (looksNew) {
    engine = new LavalinkEngine(client, config.music);
    await engine.init();
    client.music = engine;
    client.lavalink = engine;
  }
  if (engine.available()) {
    logger.info('[module] music started');
    return;
  }
  // init() does NOT throw when the node is unreachable -- retry until connected.
  logger.error('[lavalink] NO CONNECTED NODES: start Lavalink and wait for "ready to accept connections". Retrying every 30s.');
  if (musicRetryTimer) clearInterval(musicRetryTimer);
  musicRetryTimer = setInterval(async () => {
    try { await engine.manager.init({ id: client.user.id, username: client.user.username || client.user.tag }); } catch {}
    if (engine.available()) {
      clearInterval(musicRetryTimer);
      musicRetryTimer = null;
      logger.info('[module] music started (node connected on retry)');
    }
  }, 30000);
  musicRetryTimer.unref?.();
}

async function stopMusic(client) {
  if (musicRetryTimer) { clearInterval(musicRetryTimer); musicRetryTimer = null; }
  const engine = client.music;
  if (engine?.manager?.players) {
    for (const gid of [...engine.manager.players.keys()]) {
      try { await engine.stop(gid); } catch {}
    }
  }
  if (engine && typeof engine.detach === 'function') {
    try { engine.detach(); } catch {}
  }
  client.music = null;
  client.lavalink = null;
  logger.info('[module] music stopped');
}

async function startPublisher(client) {
  const pub = require('./publisher');
  await pub.startPublisher(client);
  logger.info('[module] publisher started');
}

async function stopPublisher() {
  const pub = require('./publisher');
  try { await pub.stopPublisher(); } catch {}
  logger.info('[module] publisher stopped');
}

async function startHoneypot(client) {
  const { ensureTrapWarning } = require('./honeypot/detector');
  await ensureTrapWarning(client);
  logger.info('[module] honeypot started');
}

async function startModcall(client) {
  if (config.modcall.panelChannelId) {
    logger.info('[module] modcall started (use /modcall-panel to post the button)');
  } else {
    logger.info('[module] modcall started (no panel channel configured)');
  }
  void client;
}

async function startStats(client) {
  const { startStats } = require('./stats/counter');
  startStats(client);
  logger.info('[module] stats started');
}

async function stopStats() {
  const { stopStats } = require('./stats/counter');
  try { stopStats(); } catch {}
  logger.info('[module] stats stopped');
}

async function noopStart(name) {
  logger.info(`[module] ${name} started`);
}

async function startPrivate(client) {
  try {
    const { sweepOrphans } = require('./private/rooms');
    await sweepOrphans(client);
  } catch {}
  logger.info('[module] private started');
}

function defaultManifests() {
  return [
    { name: 'music', label: 'Music', dependsOn: [], start: startMusic, stop: stopMusic },
    { name: 'publisher', label: 'Publisher', dependsOn: [], start: startPublisher, stop: stopPublisher },
    { name: 'automod', label: 'AutoMod', dependsOn: [], start: async () => noopStart('automod') },
    { name: 'honeypot', label: 'Honeypot', dependsOn: [], start: startHoneypot },
    { name: 'modcall', label: 'ModCall', dependsOn: [], start: startModcall },
    { name: 'stats', label: 'Stats', dependsOn: [], start: startStats, stop: stopStats },
    { name: 'private', label: 'Private Rooms', dependsOn: [], start: startPrivate },
  ];
}

function createManager({ manifests, isEnabledFn, log = logger } = {}) {
  const list = manifests || defaultManifests();
  const enabled = isEnabledFn || isEnabled;
  const running = new Set();

  function find(name) { return list.find(m => m.name === name); }

  async function start(name, client) {
    const m = find(name);
    if (!m) throw new Error(`unknown module: ${name}`);
    if (!enabled(name)) {
      log.info(`[module] ${name} disabled, skipping`);
      return false;
    }
    for (const dep of m.dependsOn || []) {
      if (!enabled(dep) || !running.has(dep)) {
        log.warn(`[module] ${name} not started: dependency '${dep}' is disabled`);
        return false;
      }
    }
    if (running.has(name)) {
      // start is idempotent-safe: re-running start on a live module is a no-op, not a dupe.
      log.info(`[module] ${name} already running`);
      return true;
    }
    await m.start(client);
    running.add(name);
    return true;
  }

  async function stop(name, client) {
    const m = find(name);
    if (!m) throw new Error(`unknown module: ${name}`);
    if (m.stop) await m.stop(client);
    running.delete(name);
    return true;
  }

  async function restart(name, client) {
    await stop(name, client).catch(() => {});
    return start(name, client);
  }

  async function startAll(client) {
    for (const m of list) {
      if (!enabled(m.name)) {
        log.info(`[module] ${m.name} disabled`);
        continue;
      }
      try {
        await start(m.name, client);
      } catch (e) {
        // One module must never take down the rest.
        log.error(`[module] ${m.name} failed to start:`, e?.message || e);
      }
    }
  }

  function status() {
    return list.map(m => ({
      name: m.name,
      label: m.label || m.name,
      enabled: !!enabled(m.name),
      running: running.has(m.name),
    }));
  }

  return { start, stop, restart, startAll, status, isEnabled: enabled, manifests: list };
}

// Default singleton used by ready.js and /modules.
const singleton = createManager({});
module.exports = {
  ...singleton,
  createManager,
  defaultManifests,
  setOverride,
  setModuleOverride: setOverride,
  resetOverride: (name) => setOverride(name, null),
  loadOverrides,
};
