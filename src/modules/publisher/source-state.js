// Publisher source runtime state: Discord overrides beat .env.
// Priority: persistent override (store.publisherSources) > PUBLISHER_* env > on.
// Kept separate from module on/off (store.modules) per lifecycle design.
const store = require('../../utils/store');

const KEY = 'publisherSources';
const KNOWN = ['youtube', 'twitch', 'instagram', 'tiktok', 'hpsb'];

function loadOverrides() {
  try {
    const d = store.load();
    const o = d[KEY];
    return o && typeof o === 'object' ? { ...o } : {};
  } catch { return {}; }
}

function envDefault(key) {
  try {
    const { config } = require('../../config');
    const v = config?.publisher?.sources?.[key];
    return v !== false;
  } catch { return true; }
}

// Effective on/off for one source.
function isSourceOn(key) {
  const ov = loadOverrides()[key];
  if (ov === true || ov === false) return ov;
  return envDefault(key);
}

function effectiveSources() {
  const out = {};
  for (const k of KNOWN) out[k] = isSourceOn(k);
  return out;
}

async function setSourceOverride(key, value) {
  if (!KNOWN.includes(key)) throw new Error(`unknown source: ${key}`);
  await store.exclusive(async () => {
    const d = store.load();
    d[KEY] = (d[KEY] && typeof d[KEY] === 'object') ? d[KEY] : {};
    if (value === null || value === undefined) delete d[KEY][key];
    else d[KEY][key] = !!value;
    store.save(d);
  });
}

module.exports = {
  KNOWN, loadOverrides, isSourceOn, effectiveSources, setSourceOverride,
  resetSourceOverride: (key) => setSourceOverride(key, null),
};
