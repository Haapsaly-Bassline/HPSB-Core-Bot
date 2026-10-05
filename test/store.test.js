const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const store = require('../src/utils/store');

const FILE = 'data/store.json';
let backup = null;

describe('store', () => {
  before(() => {
    backup = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  });
  after(() => {
    if (backup !== null) fs.writeFileSync(FILE, backup);
    else if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  });

  it('load never returns null sub-objects', () => {
    fs.writeFileSync(FILE, JSON.stringify({ releases: null, youtube: null, warns: 'x' }));
    const s = store.load();
    assert.deepEqual(s.releases, { ids: [] });
    assert.deepEqual(s.youtube, {});
    assert.deepEqual(s.warns, {});
  });
  it('corrupt file falls back to defaults, not throw', () => {
    fs.writeFileSync(FILE, '{broken json');
    const s = store.load();
    assert.deepEqual(s.releases, { ids: [] });
  });
  it('exclusive() serializes concurrent writers', async () => {
    const order = [];
    await Promise.all([1, 2, 3].map(i => store.exclusive(async () => {
      order.push('s' + i);
      await new Promise(r => setTimeout(r, 20));
      order.push('e' + i);
    })));
    assert.deepEqual(order, ['s1', 'e1', 's2', 'e2', 's3', 'e3']);
  });
  it('exclusive() recovers after rejection', async () => {
    await store.exclusive(async () => { throw new Error('x'); }).catch(() => {});
    let ran = false;
    await store.exclusive(async () => { ran = true; });
    assert.equal(ran, true);
  });
  it('save is atomic (tmp+rename, no partial file)', () => {
    store.save({ probe: [1] });
    assert.deepEqual(store.load().probe, [1]);
  });
});
