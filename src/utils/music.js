// Time formatting and progress bar for music overlays.

function parseDuration(str) {
  // '3:38' | '1:02:09' | 'LIVE' -> ms
  if (typeof str === 'number' && Number.isFinite(str)) return str;
  if (!str || typeof str !== 'string') return 0;
  if (/live|infinity|unknown/i.test(str)) return 0;
  const parts = str.split(':').map(p => Number(p));
  if (parts.some(isNaN)) return 0;
  let ms = 0;
  for (const p of parts) ms = ms * 60 + p;
  return ms * 1000;
}

function fmtMs(ms) {
  if (!ms || ms <= 0) return 'LIVE';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function progressBar(currentMs, totalMs, len = 12) {
  if (!totalMs || totalMs <= 0) return '▬'.repeat(len) + '🔘';
  const ratio = Math.min(Math.max(currentMs / totalMs, 0), 1);
  const pos = Math.min(Math.round(ratio * len), len);
  return '▬'.repeat(pos) + '🔘' + '▬'.repeat(Math.max(len - pos, 0));
}

module.exports = { parseDuration, fmtMs, progressBar };
