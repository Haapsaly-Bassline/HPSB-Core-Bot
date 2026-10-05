const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, fmtMs, progressBar } = require('../src/utils/music');

describe('music utils', () => {
  it('parseDuration handles m:ss, h:mm:ss, LIVE and numbers', () => {
    assert.equal(parseDuration('1:30'), 90000);
    assert.equal(parseDuration('1:02:09'), 3729000);
    assert.equal(parseDuration('LIVE'), 0);
    assert.equal(parseDuration(''), 0);
    assert.equal(parseDuration(5000), 5000);
    assert.equal(parseDuration('nope'), 0);
  });
  it('fmtMs formats and LIVE-guards', () => {
    assert.equal(fmtMs(0), 'LIVE');
    assert.equal(fmtMs(-5), 'LIVE');
    assert.equal(fmtMs(90000), '1:30');
    assert.equal(fmtMs(3729000), '1:02:09');
  });
  it('progressBar never NaNs and clamps', () => {
    const live = progressBar(0, 0, 10);
    assert.ok(!/NaN/.test(live));
    const mid = progressBar(50, 100, 10);
    assert.equal(mid.length, 12); // 10 cells + 2-unit emoji
    assert.equal(progressBar(999, 100, 10), progressBar(100, 100, 10));
  });
});
