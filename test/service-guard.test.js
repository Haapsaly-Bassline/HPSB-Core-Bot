const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const music = require('../src/modules/music/service');

describe('music service null-engine guards', () => {
  const dead = { music: null };
  it('one-liner actions answer false/null instead of throwing', async () => {
    assert.equal(await music.skip(dead, 'g'), false);
    assert.equal(await music.stop(dead, 'g'), false);
    assert.equal(await music.pause(dead, 'g', true), false);
    assert.equal(await music.seek(dead, 'g', 1000), false);
    assert.equal(await music.volume(dead, 'g', 50), false);
    assert.equal(await music.loop(dead, 'g', 1), false);
    assert.equal(await music.shuffle(dead, 'g'), false);
    assert.equal(await music.clear(dead, 'g'), false);
    assert.equal(await music.remove(dead, 'g', 0), null);
    assert.equal(await music.move(dead, 'g', 0, 1), false);
    assert.equal(await music.prev(dead, 'g'), false);
    assert.equal(music.queueView(dead, 'g'), null);
    assert.equal(music.npSnapshot(dead, 'g'), null);
    assert.equal(music.voiceChannelId(dead, 'g'), null);
  });
  it('play/join throw a clear starting-up message', async () => {
    await assert.rejects(() => music.play(dead, { guild: { id: 'g' } }, 'x'), /not initialized yet/);
    await assert.rejects(() => music.join(dead, { guild: { id: 'g' } }, null), /not initialized yet/);
  });
});
