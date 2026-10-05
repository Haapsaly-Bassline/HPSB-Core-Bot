// Publisher dedup: key = `source:type:id`.
// States: pending (reserved, in queue) -> published (sent) | released (failed, retryable).
// Published keys persist via state.js, so restart never reposts.
function keyOf(ev) {
  return `${ev?.source || '?'}:${ev?.type || '?'}:${ev?.id || ''}`;
}

class Dedup {
  constructor() {
    this.pending = new Set();
    this.published = new Set();
  }
  loadSeen(arr) {
    for (const k of arr || []) if (k) this.published.add(String(k));
  }
  dumpSeen(limit = 2000) {
    const all = [...this.published];
    return all.slice(Math.max(0, all.length - limit));
  }
  // Returns key if this event is new, null if duplicate/in-flight.
  reserve(ev) {
    const k = keyOf(ev);
    if (!ev?.id || this.published.has(k) || this.pending.has(k)) return null;
    this.pending.add(k);
    return k;
  }
  commit(k) {
    this.pending.delete(k);
    if (k) this.published.add(k);
  }
  release(k) {
    this.pending.delete(k);
  }
}

module.exports = { Dedup, keyOf };
