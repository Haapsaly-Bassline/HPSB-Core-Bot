// Хелперы музыкального модуля в духе Jockie: время, прогресс-бар, ETA.
// Всё с гардами — discord-player API между версиями гуляет.

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

function trackMs(track) {
  if (!track) return 0;
  if (Number.isFinite(track.durationMS) && track.durationMS > 0) return track.durationMS;
  return parseDuration(track.duration);
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

// { currentMs, totalMs } текущего трека — пробуем все известные формы API
function currentProgress(queue, track) {
  try {
    const ts = queue?.node?.getTimestamp?.();
    const pick = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v?.value === 'number') return v.value;
      if (typeof v?.value === 'string') return parseDuration(v.value);
      if (typeof v === 'string') return parseDuration(v);
      return 0;
    };
    if (ts) {
      // v6: { current: {label,value}, total: {label,value}, progress }
      const cur = pick(ts.current);
      const end = pick(ts.total) || pick(ts.end) || trackMs(track);
      if (end > 0) return { currentMs: cur, totalMs: end };
    }
  } catch {}
  return { currentMs: 0, totalMs: trackMs(track) };
}

// Сколько ждать до трека: остаток текущего + всё впереди стоящее
function etaMs(queue) {
  try {
    let ms = 0;
    const cur = queue?.currentTrack;
    if (cur) {
      const { currentMs, totalMs } = currentProgress(queue, cur);
      ms += Math.max(totalMs - currentMs, 0);
    }
    for (const t of queue?.tracks?.data || []) ms += trackMs(t);
    return ms;
  } catch { return 0; }
}

function queueTotalMs(queue) {
  try {
    let ms = trackMs(queue?.currentTrack);
    for (const t of queue?.tracks?.data || []) ms += trackMs(t);
    return ms;
  } catch { return 0; }
}

module.exports = { parseDuration, trackMs, fmtMs, progressBar, currentProgress, etaMs, queueTotalMs };
