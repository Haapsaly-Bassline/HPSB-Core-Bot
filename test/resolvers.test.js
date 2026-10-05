const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSearchQuery } = require('../src/modules/music/resolvers');

describe('resolvers', () => {
  it('routes known domains to engines, URLs pass through', () => {
    assert.deepEqual(resolveSearchQuery('https://soundcloud.com/a/b'), { engine: 'soundcloud', query: 'https://soundcloud.com/a/b' });
    assert.deepEqual(resolveSearchQuery('https://on.soundcloud.com/x'), { engine: 'soundcloud', query: 'https://on.soundcloud.com/x' });
    assert.deepEqual(resolveSearchQuery('https://open.spotify.com/track/abc'), { engine: 'spotify', query: 'https://open.spotify.com/track/abc' });
    assert.deepEqual(resolveSearchQuery('https://www.youtube.com/watch?v=x'), { engine: 'youtube', query: 'https://www.youtube.com/watch?v=x' });
    assert.deepEqual(resolveSearchQuery('https://a.bandcamp.com/album/x'), { engine: 'bandcamp', query: 'https://a.bandcamp.com/album/x' });
    assert.deepEqual(resolveSearchQuery('https://bandcamp.com/dj_denicore'), { engine: 'bandcamp', query: 'https://bandcamp.com/dj_denicore' });
    assert.deepEqual(resolveSearchQuery('https://x.test/file.mp3'), { engine: 'arbitrary', query: 'https://x.test/file.mp3' });
  });
  it('respects explicit search prefixes with matching engine', () => {
    assert.deepEqual(resolveSearchQuery('spsearch:foo'), { engine: 'spotify', query: 'spsearch:foo' });
    assert.deepEqual(resolveSearchQuery('dzsearch:foo'), { engine: 'deezer', query: 'dzsearch:foo' });
    assert.deepEqual(resolveSearchQuery('scsearch:foo'), { engine: 'soundcloud', query: 'scsearch:foo' });
  });
  it('plain text defaults to YouTube search', () => {
    assert.deepEqual(resolveSearchQuery('hardbass'), { engine: 'youtube', query: 'ytsearch:hardbass' });
  });
  it('empty query throws', () => {
    assert.throws(() => resolveSearchQuery('   '), /Empty query/);
  });
});
