const fs = require('node:fs');
const path = require('node:path');

// Простой JSON store без нативных зависимостей: data/store.json
// { youtube: {}, tiktok: {}, instagram: {}, site: {lastIds: []},
//   releases: {ids: []}, events: {ids: []}, posts: {ids: []}, modcall: {} }

const FILE = path.join(__dirname, '..', '..', 'data', 'store.json');

const DEFAULTS = { youtube: {}, tiktok: {}, instagram: {}, site: { lastIds: [] }, releases: { ids: [] }, events: { ids: [] }, posts: { ids: [] }, modcall: {}, warns: {}, statsChannels: {}, statsTemplates: {}, statsDisabled: [] };
// warns: { userId: [{ id, mod, reason, at }] }

function ensure() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}

function load() {
  ensure();
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
