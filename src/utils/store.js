const fs = require('node:fs');
const path = require('node:path');

// Simple JSON store without native deps: data/store.json
// { youtube: {}, tiktok: {}, instagram: {}, site: {lastIds: []},
//   releases: {ids: []}, events: {ids: []}, posts: {ids: []}, modcall: {} }

const FILE = process.env.HPSB_STORE_FILE || path.join(__dirname, '..', '..', 'data', 'store.json');

const DEFAULTS = { youtube: {}, tiktok: {}, instagram: {}, site: { lastIds: [] }, releases: { ids: [] }, events: { ids: [] }, posts: { ids: [] }, modcall: {}, warns: {}, statsChannels: {}, statsTemplates: {}, statsDisabled: [], modules: {} };
// warns: { userId: [{ id, mod, reason, at }] }

function ensure() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Deep-merge with null guards: hand-edits / partial writes must not break
// callers (state.releases.ids etc. would throw TypeError on `null`).
function normalize(state) {
  const out = Array.isArray(state) || !state || typeof state !== 'object' ? {} : state;
  for (const k of Object.keys(DEFAULTS)) {
    const d = DEFAULTS[k];
    const v = out[k];
    if (!v || typeof v !== 'object') { out[k] = clone(d); continue; }
    if (Array.isArray(d)) { if (!Array.isArray(v)) out[k] = clone(d); continue; }
    for (const sk of Object.keys(d)) {
      if (v[sk] === null || v[sk] === undefined || typeof v[sk] !== typeof d[sk] || (Array.isArray(d[sk]) && !Array.isArray(v[sk]))) {
        v[sk] = clone(d[sk]);
      }
    }
  }
  return out;
}

function load() {
  ensure();
  try {
    return normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return clone(DEFAULTS);
  }
}

// Atomic save: tmp + rename, so a kill mid-write can't leave truncated JSON
// (which previously wiped ALL dedup on next load).
function save(data) {
  ensure();
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

// In-process async mutex for read-modify-write races across awaits
// (concurrent warns/tickets/rooms lost one update on save).
let tail = Promise.resolve();
function exclusive(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

module.exports = { load, save, exclusive };
