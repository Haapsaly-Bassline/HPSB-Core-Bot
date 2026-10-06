const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// Legacy reposter/site-publisher are deleted: sync targets live on the new
// Publisher (sources -> normalize -> dedup -> queue -> router -> Discord).
const { pickTargets, skippedByFilter, keyOfEv } = require('../src/modules/publisher/sources/index');

describe('sync pickTargets (new Publisher)', () => {
  const ev = (id, publishedAt) => ({ source: 'hpsb', type: 'news', id, publishedAt });
  const items = [
    ev('c', '2026-10-03T10:00:00Z'),
    ev('a', '2026-10-01T10:00:00Z'),
    ev('b', '2026-10-02T10:00:00Z'),
    ev('z', ''),
  ];
  const known = new Set(items.map(keyOfEv));
  it('republish returns known oldest-first (undated keep feed order first)', () => {
    const got = pickTargets(items, known, { republish: 10 }).map((i) => i.id);
    assert.deepEqual(got, ['z', 'a', 'b', 'c']);
  });
  it('republish respects limit', () => {
    assert.equal(pickTargets(items, known, { republish: 2 }).length, 2);
  });
  it('republish caps at 25', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev('u' + i, '2026-10-05T10:00:00Z'));
    assert.equal(pickTargets(many, new Set(many.map(keyOfEv)), { republish: 99 }).length, 25);
  });
  it('normal mode returns only unseen, capped at 5', () => {
    const got = pickTargets(items, new Set([keyOfEv(ev('a'))]), {}).map((i) => i.id);
    assert.deepEqual(got, ['c', 'b', 'z']);
  });
  it('backfill takes newest N, posted oldest-first', () => {
    const got = pickTargets(items, new Set(), { backfill: 2 }).map((i) => i.id);
    assert.deepEqual(got, ['b', 'c']);
  });
  it('skippedByFilter honors source list', () => {
    assert.equal(skippedByFilter(null, 'news'), false);
    assert.equal(skippedByFilter({ sources: 'news' }, 'releases'), true);
    assert.equal(skippedByFilter({ sources: 'news' }, 'news'), false);
    assert.equal(skippedByFilter({ sources: 'youtube' }, 'tiktok'), true);
  });
  it('keyOfEv is source:type:id', () => {
    assert.equal(keyOfEv({ source: 'youtube', type: 'video', id: 'x' }), 'youtube:video:x');
  });
  it('dateMs never produces NaN on garbage', () => {
    const { dateMs } = require('../src/modules/publisher/sources/fetch.js');
    assert.equal(dateMs('garbage'), 0);
    assert.equal(dateMs(''), 0);
    assert.equal(dateMs(null), 0);
    assert.ok(dateMs('2026-10-01T10:00:00Z') > 0);
  });
});
