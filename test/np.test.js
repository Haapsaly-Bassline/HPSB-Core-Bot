const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildComponents, buildRow, handleSeekModal } = require('../src/modules/music/np');

const snap = {
  track: { title: 'T', url: 'https://x.test/t', author: 'A', source: 'soundcloud', isLive: false },
  positionMs: 5000,
  durationMs: 200000,
  repeatMode: 0,
  paused: false,
  size: 0,
  radioLabel: null,
};

describe('now playing components', () => {
  it('exports the seek modal handler (regression: undefined export crashed np.js)', () => {
    assert.equal(typeof handleSeekModal, 'function');
  });
  it('main row has the five playback buttons', () => {
    assert.equal(buildRow(snap).components.length, 5);
  });
  it('adds the seek row for normal tracks', () => {
    const rows = buildComponents(snap);
    assert.equal(rows.length, 2);
    const ids = rows[1].components.map((c) => c.data.custom_id);
    assert.deepEqual(ids, ['np:seek:-30', 'np:seek:-10', 'np:seek:+10', 'np:seek:+30', 'np:seekmodal']);
  });
  it('hides the seek row for live streams', () => {
    const live = { ...snap, durationMs: 0, track: { ...snap.track, isLive: true } };
    assert.equal(buildComponents(live).length, 1);
  });
});
