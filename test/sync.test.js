const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const hpsb = require('../src/modules/site-publisher/poller');
const { ytPickTargets, skippedByFilter } = require('../src/modules/reposter/poller');

describe('sync pickTargets', () => {
  const items = [
    { uid: 'c', date: '2026-10-03T10:00:00Z' },
    { uid: 'a', date: '2026-10-01T10:00:00Z' },
    { uid: 'b', date: '2026-10-02T10:00:00Z' },
    { uid: 'z', date: '' },
  ];
  const known = new Set(['a', 'b', 'c', 'z']);
  it('republish returns known oldest-first', () => {
    const got = hpsb.pickTargets(items, known, { republish: 10 }).map(i => i.uid);
    assert.deepEqual(got, ['z', 'a', 'b', 'c']);
  });
  it('republish respects limit', () => {
    assert.equal(hpsb.pickTargets(items, known, { republish: 2 }).length, 2);
  });
  it('republish caps at 25', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ uid: 'u' + i, date: '2026-10-05T10:00:00Z' }));
    assert.equal(hpsb.pickTargets(many, new Set(many.map(m => m.uid)), { republish: 99 }).length, 25);
  });
  it('normal mode returns only unseen, capped at 5', () => {
    const got = hpsb.pickTargets(items, new Set(['a']), {}).map(i => i.uid);
    assert.deepEqual(got, ['c', 'b', 'z']);
  });
  it('backfill takes first N regardless', () => {
    assert.deepEqual(hpsb.pickTargets(items, new Set(), { backfill: 2 }).map(i => i.uid), ['c', 'a']);
  });
  it('skippedByFilter honors source list', () => {
    assert.equal(hpsb.skippedByFilter(null, 'news'), false);
    assert.equal(hpsb.skippedByFilter({ sources: ['news'] }, 'releases'), true);
    assert.equal(hpsb.skippedByFilter({ sources: ['news'] }, 'news'), false);
    assert.equal(skippedByFilter({ sources: ['youtube'] }, 'tiktok'), true);
  });
  it('ytPickTargets mirrors chronological order', () => {
    const yt = [
      { id: 'n3', date: '2026-10-03T00:00:00Z' },
      { id: 'n1', date: '2026-10-01T00:00:00Z' },
      { id: 'n2', date: '2026-10-02T00:00:00Z' },
    ];
    const got = ytPickTargets(yt, new Set(['n1', 'n2', 'n3']), { republish: 10 }).map(i => i.id);
    assert.deepEqual(got, ['n1', 'n2', 'n3']);
  });
  it('safeDate never throws on garbage', () => {
    assert.ok(hpsb.safeDate('garbage') instanceof Date);
    assert.ok(hpsb.safeDate('') instanceof Date);
    assert.ok(hpsb.safeDate(null) instanceof Date);
  });
});
