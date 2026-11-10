const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FAN_RE,
  extractPageData,
  parseFanData,
  normalizeCollectionItem,
} = require('../src/modules/music/bandcamp-fan');

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

describe('Bandcamp fan collection parsing', () => {
  it('accepts a fan profile URL, not a custom artist domain', () => {
    assert.equal(FAN_RE.test('https://bandcamp.com/dj_denicore'), true);
    assert.equal(FAN_RE.test('https://www.bandcamp.com/dj_denicore/'), true);
    assert.equal(FAN_RE.test('https://artist.bandcamp.com/album/release'), false);
  });

  it('parses the pagedata blob regardless of fan_data property ordering', () => {
    const data = {
      collection_count: 2,
      fan_data: { fan_id: 12345, name: 'Deni "Core"', username: 'dj_denicore' },
      collection_data: { item_count: 2, last_token: 'token::a::' },
      item_cache: { collection: {} },
    };
    const html = '<html><div id="pagedata" data-blob="' +
      escapeAttribute(JSON.stringify(data)) + '"></div></html>';
    assert.deepEqual(extractPageData(html), data);
    assert.deepEqual(parseFanData(data), {
      username: 'dj_denicore',
      name: 'Deni "Core"',
      fanId: 12345,
    });
  });

  it('creates canonical album and track URLs from url_hints', () => {
    assert.deepEqual(
      normalizeCollectionItem({
        tralbum_type: 'a',
        url_hints: { subdomain: 'labelname', slug: 'release-title' },
        band_name: 'Example Label',
        item_title: 'Release',
        num_streamable_tracks: 8,
        item_url: 'https://custom.example/release',
      }),
      {
        band: 'Example Label',
        title: 'Release',
        url: 'https://labelname.bandcamp.com/album/release-title',
        kind: 'album',
        tracks: 8,
        key: 'https://custom.example/release',
        token: null,
      },
    );
    assert.equal(
      normalizeCollectionItem({
        tralbum_type: 't',
        url_hints: { subdomain: 'artist.bandcamp.com', slug: 'track-title' },
        item_title: 'Track',
      }).url,
      'https://artist.bandcamp.com/track/track-title',
    );
  });

  it('keeps an absolute release URL when url_hints are not available', () => {
    const result = normalizeCollectionItem({
      tralbum_type: 'a',
      item_url: 'https://band.bandcamp.com/album/my-release',
      item_title: 'My Release',
    });
    assert.equal(result.url, 'https://band.bandcamp.com/album/my-release');
    assert.equal(result.kind, 'album');
  });

  it('rejects malformed/missing page data with useful error text', () => {
    assert.throws(() => extractPageData('<html></html>'), /no #pagedata block/);
    assert.throws(() => extractPageData('<div id="pagedata" data-blob="{bad"></div>'), /Could not parse/);
  });
});
