const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseProfileUrl,
  endpointForProfile,
  extractClientId,
  extractScriptUrls,
  collectionFromResponse,
  normalizeProfileEntry,
} = require('../src/modules/music/soundcloud-profile');

describe('SoundCloud profile importer', () => {
  it('recognizes each public profile tab and the root profile', () => {
    assert.deepEqual(parseProfileUrl('https://soundcloud.com/BapeFiendsBand/tracks'), {
      username: 'BapeFiendsBand',
      section: 'tracks',
      sectionLabel: 'Tracks',
      profileUrl: 'https://soundcloud.com/BapeFiendsBand',
      pageUrl: 'https://soundcloud.com/BapeFiendsBand/tracks',
    });
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/albums').section, 'albums');
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/likes').section, 'likes');
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/reposts').section, 'reposts');
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/sets').section, 'sets');
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/playlists').section, 'sets');
    assert.equal(parseProfileUrl('https://soundcloud.com/artist').section, 'all');
  });

  it('does not mistake a track, playlist or short share URL for a profile page', () => {
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/track-title'), null);
    assert.equal(parseProfileUrl('https://soundcloud.com/artist/sets/playlist-title'), null);
    assert.equal(parseProfileUrl('https://on.soundcloud.com/abcd'), null);
    assert.equal(parseProfileUrl('https://soundcloud.com/discover'), null);
    assert.equal(parseProfileUrl('javascript:alert(1)'), null);
  });

  it('maps each profile section to its own SoundCloud API endpoint', () => {
    assert.equal(endpointForProfile(12345, 'tracks'), 'https://api-v2.soundcloud.com/users/12345/tracks');
    assert.equal(endpointForProfile(12345, 'albums'), 'https://api-v2.soundcloud.com/users/12345/albums');
    assert.equal(endpointForProfile(12345, 'sets'), 'https://api-v2.soundcloud.com/users/12345/playlists');
    assert.equal(endpointForProfile(12345, 'likes'), 'https://api-v2.soundcloud.com/users/12345/likes');
    assert.equal(endpointForProfile(12345, 'reposts'), 'https://api-v2.soundcloud.com/stream/users/12345/reposts');
    assert.throws(() => endpointForProfile('not-id', 'tracks'), /invalid user ID/);
  });

  it('extracts the web client ID and first-party JS URLs', () => {
    assert.equal(extractClientId('window.config={client_id:"AbCdEf0123456789AbCdEf0123456789"}'),
      'AbCdEf0123456789AbCdEf0123456789');
    const urls = extractScriptUrls(
      '<script src="https://a-v2.sndcdn.com/assets/app.js"></script>' +
      '<script src="/assets/other.js"></script>' +
      '<script src="https://evil.example/steal.js"></script>',
      'https://soundcloud.com/artist/tracks'
    );
    assert.deepEqual(urls, [
      'https://a-v2.sndcdn.com/assets/app.js',
      'https://soundcloud.com/assets/other.js',
    ]);
  });

  it('accepts arrays and paginated collection responses', () => {
    assert.deepEqual(collectionFromResponse([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(collectionFromResponse({ collection: [{ id: 2 }], next_href: 'https://api-v2.soundcloud.com/next' }), [{ id: 2 }]);
    assert.deepEqual(collectionFromResponse({ collection: null }), []);
  });

  it('normalizes tracks and albums/playlists nested in likes/reposts', () => {
    const track = normalizeProfileEntry({
      created_at: '2026-01-01T00:00:00Z',
      track: {
        kind: 'track', id: 123, title: 'Track',
        permalink_url: 'https://soundcloud.com/artist/track',
        user: { username: 'Artist' },
      },
    }, 'likes');
    assert.equal(track.kind, 'track');
    assert.equal(track.title, 'Track');
    assert.equal(track.url, 'https://soundcloud.com/artist/track');
    assert.equal(track.band, 'Artist');

    const album = normalizeProfileEntry({
      playlist: {
        kind: 'playlist', id: 456, title: 'EP',
        permalink_url: 'https://soundcloud.com/artist/sets/ep',
        is_album: true,
      },
    }, 'albums');
    assert.equal(album.kind, 'album');
    assert.equal(album.url, 'https://soundcloud.com/artist/sets/ep');

    const playlist = normalizeProfileEntry({
      playlist: {
        kind: 'playlist', id: 789, title: 'Mix',
        permalink_url: 'https://soundcloud.com/artist/sets/mix',
      },
    }, 'reposts');
    assert.equal(playlist.kind, 'playlist');
    assert.equal(playlist.title, 'Mix');
  });

  it('filters records that do not match the selected profile tab', () => {
    assert.equal(normalizeProfileEntry({
      kind: 'playlist', title: 'Mix',
      permalink_url: 'https://soundcloud.com/artist/sets/mix',
    }, 'tracks'), null);
    assert.equal(normalizeProfileEntry({
      kind: 'track', title: 'Track',
      permalink_url: 'https://soundcloud.com/artist/track',
    }, 'sets'), null);
  });
});
