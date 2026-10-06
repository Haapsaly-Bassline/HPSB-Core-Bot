const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Dedup, keyOf } = require('../src/modules/publisher/dedup');
const { createQueue } = require('../src/modules/publisher/queue');
const { resolveTarget, resolveChannel, pingFor } = require('../src/modules/publisher/router');
const { format } = require('../src/modules/publisher/formatter');
const live = require('../src/modules/publisher/live');
const { createPipeline } = require('../src/modules/publisher/pipeline');
const { loadState, blank } = require('../src/modules/publisher/state');

const cfg = {
  announceRoleId: 'R1', mediaRoleId: 'R2',
  publisher: { announcementsChannelId: 'ANN', mediaChannelId: 'MED' },
  reposter: { youtube: [{ key: 'yt1', channelId: 'LEGACY' }] },
  hpsb: { releases: { channelId: 'REL' } },
};

describe('publisher core', () => {
  const TMP = 'data/store.publisher.test.tmp.json';
  const store = require('../src/utils/store');
  before(() => { store._useFile(TMP); });
  after(() => {
    store._useFile(null);
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  });
  it('dedup keys and reserve/commit/release', () => {
    const d = new Dedup();
    const ev = { source: 'youtube', type: 'video', id: 'abc' };
    assert.equal(keyOf(ev), 'youtube:video:abc');
    const k = d.reserve(ev);
    assert.equal(k, 'youtube:video:abc');
    assert.equal(d.reserve(ev), null);
    d.release(k);
    assert.equal(d.reserve(ev), k);
    d.commit(k);
    assert.equal(d.reserve(ev), null);
    assert.deepEqual(d.dumpSeen(), ['youtube:video:abc']);
    const d2 = new Dedup();
    d2.loadSeen(['x', null, 'y']);
    assert.deepEqual(d2.dumpSeen(), ['x', 'y']);
  });
  it('queue is FIFO and stoppable', async () => {
    const q = createQueue();
    const got = [];
    const run = q.start(async (j) => { got.push(j); });
    q.push(1); q.push(2); q.push(3);
    await q.onIdle();
    q.stop();
    await run;
    assert.deepEqual(got, [1, 2, 3]);
    assert.equal(q.push(4), false);
  });
  it('router targets and channels', () => {
    assert.equal(resolveTarget({ source: 'youtube' }), 'media');
    assert.equal(resolveTarget({ source: 'instagram' }), 'media');
    assert.equal(resolveTarget({ source: 'tiktok' }), 'media');
    assert.equal(resolveTarget({ source: 'hpsb' }), 'announcements');
    assert.equal(resolveTarget({ source: 'twitch' }), 'announcements');
    assert.equal(resolveTarget({ source: 'x', target: 'media' }), 'media');
    assert.equal(resolveChannel('media', cfg), 'MED');
    assert.equal(resolveChannel('announcements', cfg), 'ANN');
    assert.equal(resolveChannel('media', {}), '');
    assert.equal(pingFor('media', cfg), '<@&R2>');
    assert.equal(pingFor('announcements', cfg), '<@&R1>');
    assert.equal(pingFor('media', {}), '');
  });
  it('formatter builds all families', () => {
    const yt = format({ source: 'youtube', type: 'video', id: 'v', title: 'T', author: 'A', url: 'https://x' }).embed.toJSON();
    assert.ok(yt.title.includes('YouTube'));
    const ig = format({ source: 'instagram', type: 'reel', id: 'r', title: 'T', author: 'u', url: 'https://x' }).embed.toJSON();
    assert.ok(ig.title.includes('Instagram'));
    const tt = format({ source: 'tiktok', type: 'video', id: 't', title: 'T', author: 'u', url: 'https://x' }).embed.toJSON();
    assert.ok(tt.title.includes('TikTok'));
    const rel = format({ source: 'hpsb', type: 'release', id: 'r', title: 'R', description: 'D', url: 'https://x', metadata: { artist: 'A', genre: ['x'], year: 2026, tracks: ['t1'] } }).embed.toJSON();
    assert.ok(rel.title.includes('Release') && rel.description.includes('t1'));
    const ev = format({ source: 'hpsb', type: 'event', id: 'e', title: 'E', metadata: { location: 'L' } }).embed.toJSON();
    assert.ok(ev.title.includes('Event') && ev.description.includes('L'));
    const nw = format({ source: 'hpsb', type: 'news', id: 'n', title: 'N' }).embed.toJSON();
    assert.ok(nw.title.includes('News'));
  });
  it('pipeline: event->media, duplicate suppressed, failure retried', async () => {
    const sent = [];
    let calls = 0;
    let failNext = false;
    const p = createPipeline({
      client: {}, config: cfg, log: console,
      sender: async (ch, payload) => {
        calls++;
        if (failNext) { failNext = false; throw new Error('discord down'); }
        sent.push({ ch, n: calls });
        return { id: 'm' };
      },
    });
    const run = p.start();
    const ev = { source: 'youtube', type: 'video', id: 'v1', title: 'T', url: 'https://x' };
    assert.deepEqual((await p.ingest(ev)).ok, true);
    assert.deepEqual((await p.ingest(ev)).ok, false); // duplicate in-flight
    await p.queue.onIdle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ch, 'MED');
    assert.deepEqual((await p.ingest(ev)).ok, false); // duplicate published
    // failure releases reservation -> retry works
    const ev2 = { source: 'youtube', type: 'video', id: 'v2', title: 'T2', url: 'https://x' };
    failNext = true;
    await p.ingest(ev2);
    await p.queue.onIdle();
    assert.equal(sent.length, 1);
    await p.ingest(ev2);
    await p.queue.onIdle();
    assert.equal(sent.length, 2);
    // invalid event dropped
    assert.deepEqual((await p.ingest({ source: 'x' })).ok, false);
    p.stop();
    await run;
  });
  it('pipeline drops gracefully with no channel configured', async () => {
    const sent = [];
    const p = createPipeline({ client: {}, config: {}, log: { warn() {} }, sender: async (ch, pl) => { sent.push(ch); } });
    const run = p.start();
    await p.ingest({ source: 'youtube', type: 'video', id: 'v9', title: 'T' });
    await p.queue.onIdle();
    assert.equal(sent.length, 0);
    p.stop();
    await run;
  });
  it('live multistream: create then update, offline handling', () => {
    const st = live.blank();
    assert.equal(live.isLive(st), false);
    assert.equal(live.applyOnline(st, 'twitch', { streamId: 's1', url: 'https://twitch.tv/x' }), 'create');
    assert.equal(live.isLive(st), true);
    st.discord = { channelId: 'c', messageId: 'm' };
    assert.equal(live.applyOnline(st, 'youtube', { videoId: 'v1', url: 'https://youtu.be/v1' }), 'update');
    const btns = live.liveButtons(st, {});
    assert.equal(btns.length, 2);
    assert.equal(live.applyOffline(st, 'twitch'), 'update');
    assert.equal(live.isLive(st), true);
    assert.equal(live.applyOffline(st, 'youtube'), 'ended');
    assert.equal(live.isLive(st), false);
    assert.equal(live.applyOnline(st, 'nope', {}), 'noop');
  });
  it('state blank/load shape', async () => {
    const b = blank();
    assert.deepEqual(Object.keys(b).sort(), ['live', 'reminders', 'seen']);
    // Earlier tests in this file persist seen keys to the real store --
    // reset the publisher slice so this asserts shape, not test order.
    const { saveState } = require('../src/modules/publisher/state');
    await saveState({ seen: [], live: {}, reminders: {} });
    assert.deepEqual(loadState(), b);
  });
});
