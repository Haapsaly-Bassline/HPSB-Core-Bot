const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { addedTrackEmbed, playlistAddedEmbed, liveAddedEmbed, fanCollectionEmbed, sourceBadge } = require('../src/utils/embeds');
const { buildEmbed } = require('../src/modules/music/np');

const track = { title: 'T', url: 'https://x.test/t', author: 'A', thumbnail: '', durationMs: 200000, durationLabel: '3:20', requesterTag: 'u#1', isLive: false, source: 'soundcloud' };

describe('embeds', () => {
  it('sourceBadge maps known sources, empty otherwise', () => {
    assert.equal(sourceBadge('soundcloud'), '🟠 SoundCloud');
    assert.equal(sourceBadge('YOUTUBE'), '🔴 YouTube');
    assert.equal(sourceBadge('nope'), '');
    assert.equal(sourceBadge(''), '');
  });
  it('added track embed is valid', () => {
    const j = addedTrackEmbed({ ...track, duration: '3:20', source: 'soundcloud' }, 1, 'u#1', 0, null).toJSON();
    assert.ok(j.title.includes('Added Track') && j.title.includes('SoundCloud'));
    assert.ok(j.description.includes('[T](https://x.test/t)'));
  });
  it('playlist embed is valid', () => {
    const j = playlistAddedEmbed({ title: 'Pl', count: 25, first: track }, 'u#1').toJSON();
    assert.ok(j.title.includes('Playlist added'));
    assert.ok(j.description.includes('**25**'));
  });
  it('live embed is valid', () => {
    const j = liveAddedEmbed({ label: 'Radio', url: 'https://x/y.mp3', source: 'http' }, 'u#1').toJSON();
    assert.ok(j.title.includes('Live'));
    assert.ok(j.description.includes('LIVE'));
  });
  it('fan embed is valid', () => {
    const j = fanCollectionEmbed({ fanName: 'F (@f)', fanUrl: 'https://bandcamp.com/f', added: [{ title: 'A', band: 'B', count: 5 }], failed: 0, totalTracks: 5 }, 'u#1').toJSON();
    assert.ok(j.title.includes('Fan collection'));
    assert.equal(j.url, 'https://bandcamp.com/f');
  });
  it('np embed handles track and radio snapshots', () => {
    const snap = { track, positionMs: 5000, durationMs: 200000, repeatMode: 0, paused: false, size: 3, radioLabel: null };
    const j = buildEmbed(snap).toJSON();
    assert.ok(j.title.includes('Now Playing') && j.title.includes('SoundCloud'));
    assert.equal(j.fields.length, 2);
    const r = buildEmbed({ ...snap, radioLabel: 'HPSB', track: { ...track, isLive: true, durationMs: 0 } }).toJSON();
    assert.ok(r.title.includes('Radio'));
  });
});
