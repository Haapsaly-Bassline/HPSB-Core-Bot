const fs = require('node:fs');
const path = require('node:path');

function ts() {
  return new Date().toISOString();
}

// Файловый транспорт: /logs работает при любом способе запуска (PM2/консоль/фон).
// Ротация: при старте хвост >5МБ уезжает в bot.old.log.
const LOG_FILE = path.join(__dirname, '..', '..', 'data', 'bot.log');
try {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
    try { fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch {}
  }
} catch {}

function str(x) {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return x.stack || x.message;
  try { return JSON.stringify(x); } catch { return String(x); }
}

function line(...a) {
  return `[${ts()}] ` + a.map(str).join(' ') + '\n';
}

function fileAppend(text) {
  try { fs.appendFileSync(LOG_FILE, text); } catch {}
}

const logger = {
  info: (...a) => { console.log(`[${ts()}] [INFO]`, ...a); fileAppend(line('[INFO]', ...a)); },
  warn: (...a) => { console.warn(`[${ts()}] [WARN]`, ...a); fileAppend(line('[WARN]', ...a)); },
  error: (...a) => { console.error(`[${ts()}] [ERROR]`, ...a); fileAppend(line('[ERROR]', ...a)); },
};

module.exports = { logger };
