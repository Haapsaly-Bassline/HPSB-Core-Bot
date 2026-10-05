// Serial in-memory queue: one worker, FIFO. Concurrent webhook/poll ingests
// must not cause parallel Discord sends or interleaved store writes.
function createQueue() {
  const items = [];
  let running = false;
  let stopped = false;
  let inFlight = 0;
  let idleResolvers = [];

  function checkIdle() {
    if (!items.length && inFlight === 0) {
      const rs = idleResolvers;
      idleResolvers = [];
      for (const r of rs) { try { r(); } catch {} }
    }
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
  }

  function push(job) {
    if (stopped) return false;
    items.push(job);
    return true;
  }

  function size() { return items.length; }
  function onIdle() {
    if (!items.length && inFlight === 0) return Promise.resolve();
    return new Promise(r => idleResolvers.push(r));
  }

  return { start, stop, push, size, onIdle };
}

module.exports = { createQueue };
