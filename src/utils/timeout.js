// Async helpers: nothing in the Publisher may await a Discord/network call
// forever -- one hanging call wedged the whole /sync loop with no error.
function withTimeout(promise, ms, label = 'op') {
  let timer = null;
  const gate = new Promise((_, reject) => {
    // NOTE: intentionally NOT unref'd -- an unref'd gate doesn't keep the
    // event loop alive, so in a quiet process the waiter would be cancelled
    // instead of rejected. The gate always settles, so nothing leaks.
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), gate]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { withTimeout, sleep };
