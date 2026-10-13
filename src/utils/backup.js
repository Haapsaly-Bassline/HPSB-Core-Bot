// Periodic snapshots of the JSON store: data/backups/store-*.json, pruned.
// The store is a single file -- one bad write/kill without a backup loses ALL
// memory (dedup, warns, tickets, overrides). Never throws; reports result.
const fs = require('node:fs');
const path = require('node:path');

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function doBackup(storeFile, backupDir, keep = 10) {
  try {
    if (!storeFile || !fs.existsSync(storeFile)) return { ok: false, reason: 'no store file yet' };
    fs.mkdirSync(backupDir, { recursive: true });
    const dest = path.join(backupDir, `store-${stamp()}.json`);
    fs.copyFileSync(storeFile, dest);
    const files = fs.readdirSync(backupDir)
      .filter((f) => /^store-\d{8}-\d{6}\.json$/.test(f))
      .sort();
    while (files.length > Math.max(1, keep)) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(backupDir, old)); } catch {}
    }
    return { ok: true, file: dest, kept: files.length };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) };
  }
}

module.exports = { doBackup, stamp };
