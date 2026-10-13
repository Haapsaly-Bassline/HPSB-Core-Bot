// Serial in-memory queue: one worker, FIFO. Concurrent webhook/poll ingests
// must not cause parallel Discord sends or interleaved store writes.
function createQueue() {
  const items = [];
  let running = false;
  let stopped = false;
  let inFlight = 0;
  let idleResolvers = [];
  let drainResolvers = [];

  function checkIdle() {
    if (!items.length && inFlight === 0) {
      const rs = idleResolvers;
      idleResolvers = [];
      for (const r of rs) { try { r(); } catch {} }
    }
    if (inFlight === 0) {
      const ds = drainResolvers;
      drainResolvers = [];
      for (const r of ds) { try { r(); } catch {} }
    }
  }

  // Resolves when no worker is mid-send (backlog may remain abandoned).
  function drained() {
    if (inFlight === 0) return Promise.resolve();
    return new Promise(r => drainResolvers.push(r));
  }

  async function start(worker) {
    if (running) return;
    running = true;
    stopped = false;
    while (running) {
      const job = items.shift();
      if (!job) {
        checkIdle();
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      inFlight++;
      try {
        await worker(job);
      } catch {
        // Worker owns its error handling; queue never dies on a bad job.
      } finally {
        inFlight--;
        checkIdle();
      }
    }
    checkIdle();
  }

  function stop() {
    running = false;
    stopped = true;
    // Do NOT wake onIdle() early: a waiter (runSync) must observe the real
    // outcome of its in-flight job, not a lie. Resolution happens only via
    // checkIdle when inFlight hits 0 AND the backlog is gone; abandoned jobs
    // are handed back via takeAll() below so the caller can release them.
  }

  // Remove every unprocessed job (for graceful stop: caller releases their
  // dedup keys so nothing is silently marked seen without posting).
  function takeAll() {
    const rest = items.splice(0, items.length);
    checkIdle();
    return rest;
  }

  function push(job) {
    if (stopped) return false;
    items.push(job);
    return true;
  }

  function size() { return items.length; }
  function onIdle() {
    if (stopped && inFlight === 0) return Promise.resolve();
    if (!stopped && !items.length && inFlight === 0) return Promise.resolve();
    return new Promise(r => idleResolvers.push(r));
  }

  return { start, stop, push, size, onIdle, drained, takeAll };
}

module.exports = { createQueue };
