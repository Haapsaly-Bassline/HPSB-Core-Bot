const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { toItems, fetchWithFallback, oldestFirst } = require('../src/modules/publisher/sources/fetch');
const { pickTargets, skippedByFilter, keyOfEv, runSync } = require('../src/modules/publisher/sources/index');
const { normalize: normalizeYt } = require('../src/modules/publisher/sources/youtube');
const { normalize: normalizeTt } = require('../src/modules/publisher/sources/tiktok');
const { normalizeWebhook: normalizeIg } = require('../src/modules/publisher/sources/instagram');
const { normalizeRelease, normalizeEvent, normalizeNews, dueReminders } = require('../src/modules/publisher/sources/hpsb');
const { verifySignature } = require('../src/modules/publisher/sources/twitch');
const { createPipeline } = require('../src/modules/publisher/pipeline');

describe('publisher sources: tolerant feed parsing', () => {
  it('parses RSS xml and JSON shapes', () => {
    const rss = `<rss><channel><item><guid>u1</guid><title>T</title><link>https://x/1</link><pubDate>2026-10-01T10:00:00Z</pubDate></item></channel></rss>`;
    assert.equal(toItems(rss)[0].uid, 'u1');
    assert.deepEqual(toItems([{ id: 'a', title: 'A' }]).map((i) => i.uid), ['a']);
    assert.deepEqual(toItems({ data: [{ slug: 's' }] }).map((i) => i.uid), ['s']);
    assert.deepEqual(toItems(null), []);
    assert.deepEqual(toItems('garbage'), []);
  });
  it('fetchWithFallback uses RSS when API fails or is empty', async () => {
    const rss = `<rss><channel><item><guid>r1</guid><title>R</title></item></channel></rss>`;
    const failHttp = { get: async () => { throw new Error('down'); } };
    const okHttp = {
      get: async (url) => ({ data: url.includes('fallback') ? rss : { data: [] } }),
    };
    const r1 = await fetchWithFallback('https://api/x', 'https://fallback/y', { http: failHttp });
    assert.equal(r1.items.length, 0);
    const r2 = await fetchWithFallback('https://api/x', 'https://fallback/y', { http: okHttp });
    assert.equal(r2.via, 'rss');
    assert.equal(r2.items[0].uid, 'r1');
  });
  it('oldestFirst orders dated chronologically', () => {
    const got = oldestFirst([
      { date: '2026-10-03T00:00:00Z', uid: 'c' },
      { date: '2026-10-01T00:00:00Z', uid: 'a' },
      { date: '', uid: 'z' },
      { date: '2026-10-02T00:00:00Z', uid: 'b' },
    ]).map((i) => i.uid);
    assert.deepEqual(got, ['a', 'b', 'c', 'z']);
  });
});

describe('publisher sources: normalized events', () => {
  it('youtube/tiktok/instagram normalize to media events', () => {
    const yt = normalizeYt({ id: 'dQw4w9WgXcQ', title: 'Hit', author: 'HPSB' });
    assert.equal(yt.source, 'youtube');
    assert.equal(yt.target, 'media');
    assert.ok(yt.url.includes('dQw4w9WgXcQ'));
    const tt = normalizeTt({ video_id: '123', desc: 'Dance', create_time: 1728000000 }, 'djuser');
    assert.equal(tt.source, 'tiktok');
    assert.ok(tt.url.includes('123'));
    const ig = normalizeIg({ id: 'm1', username: 'hpsb', caption: 'New post', shortcode: 'abc' });
    assert.equal(ig.source, 'instagram');
    assert.equal(ig.target, 'media');
    assert.equal(normalizeIg({}), null);
  });
  it('youtube type is stable video (no title sniffing)', () => {
    const a = normalizeYt({ id: 'dQw4w9WgXcQ', title: 'Best Short film ever', author: 'HPSB' });
    const b = normalizeYt({ id: 'dQw4w9WgXcQ', title: undefined, author: 'HPSB' });
    assert.equal(a.type, 'video');
    assert.equal(b.type, 'video');
  });
  it('tiktok rejects empty username, instagram strips tracking params', () => {
    assert.equal(normalizeTt({ video_id: '123', desc: 'x' }, ''), null);
    const ig = normalizeIg({ username: 'hpsb', caption: 'p', url: 'https://www.instagram.com/p/abc/?igsh=XYZ&utm_source=x' });
    assert.equal(ig.id, 'https://www.instagram.com/p/abc/');
  });
  it('hpsb release/event/news normalize to announcements', () => {
    const rel = normalizeRelease({ uid: 'r1', title: 'R', desc: 'D', raw: { artist: 'A', genre: ['bass'], year: 2026, tracks: [{ title: 't1' }] } }, {});
    assert.equal(rel.target, 'announcements');
    assert.equal(rel.metadata.artist, 'A');
    const ev = normalizeEvent({ uid: 'e1', title: 'E', raw: { name: 'Party', location: 'Haapsalu' } }, {});
    assert.equal(ev.type, 'event');
    assert.equal(ev.metadata.location, 'Haapsalu');
    const nw = normalizeNews({ uid: 'n1', title: 'N', desc: 'D' });
    assert.equal(nw.type, 'news');
  });
  it('dueReminders fires 24h/1h tiers once, ignores dateless', () => {
    const now = Date.now();
    const mk = (id, ms) => ({ id, metadata: { startMs: ms } });
    const items = [mk('past', now - 1000), mk('soon1h', now + 30 * 60 * 1000), mk('soon24h', now + 20 * 3600 * 1000), { id: 'nostart', metadata: {} }];
    const { due, noStart } = dueReminders(items, { soon1h: ['24h'] });
    assert.deepEqual(due.map((d) => d.ev.id + d.tier).sort(), ['soon1h1h', 'soon24h24h']);
    assert.equal(noStart, 1);
    // Fresh event <1h out still owes the 24h notice first.
    const fresh = dueReminders([mk('f', now + 30 * 60 * 1000)], {});
    assert.deepEqual(fresh.due.map((d) => d.tier), ['24h', '1h']);
  });
});

describe('publisher sources: pickTargets + filters', () => {
  const evs = [
    { source: 'hpsb', type: 'news', id: 'c', publishedAt: '2026-10-03T10:00:00Z' },
    { source: 'hpsb', type: 'news', id: 'a', publishedAt: '2026-10-01T10:00:00Z' },
    { source: 'hpsb', type: 'news', id: 'b', publishedAt: '2026-10-02T10:00:00Z' },
  ];
  it('republish returns known oldest-first, caps at 25', () => {
    const known = new Set(evs.map(keyOfEv));
    assert.deepEqual(pickTargets(evs, known, { republish: 10 }).map((e) => e.id), ['a', 'b', 'c']);
    assert.equal(pickTargets(evs, known, { republish: 2 }).length, 2);
    const many = Array.from({ length: 30 }, (_, i) => ({ source: 's', type: 't', id: 'u' + i, publishedAt: '2026-10-05T10:00:00Z' }));
    assert.equal(pickTargets(many, new Set(many.map(keyOfEv)), { republish: 99 }).length, 25);
  });
  it('default returns unseen capped at 5, backfill takes newest N', () => {
    const got = pickTargets(evs, new Set(['hpsb:news:a']), {}).map((e) => e.id);
    assert.deepEqual(got, ['c', 'b']);
    const three = [...evs, { source: 'hpsb', type: 'news', id: 'd', publishedAt: '2026-10-04T10:00:00Z' }];
    assert.deepEqual(pickTargets(three, new Set(), { backfill: 2 }).map((e) => e.id), ['c', 'd']);
  });
  it('skippedByFilter honors aliases', () => {
    assert.equal(skippedByFilter(null, 'news'), false);
    assert.equal(skippedByFilter({ sources: 'hpsb' }, 'news'), false);
    assert.equal(skippedByFilter({ sources: 'news' }, 'releases'), true);
    assert.equal(skippedByFilter({ sources: 'youtube' }, 'tiktok'), true);
    assert.equal(skippedByFilter({ sources: 'all' }, 'tiktok'), false);
  });
});

describe('publisher sources: twitch webhook security', () => {
  const secret = 'testsecret123';
  const body = JSON.stringify({ subscription: { type: 'stream.online' }, event: { id: 's1' } });
  const hdrs = (sig) => ({
    'twitch-eventsub-message-id': 'msg1',
    'twitch-eventsub-message-timestamp': new Date().toISOString(),
    'twitch-eventsub-message-signature': sig,
  });
  const sign = () => 'sha256=' + crypto.createHmac('sha256', secret).update('msg1' + hdrs('').__ts + body).digest('hex');
  it('accepts valid signature, rejects forged/stale/empty', () => {
    const ts = new Date().toISOString();
    const good = 'sha256=' + crypto.createHmac('sha256', secret).update('msg1' + ts + body).digest('hex');
    const h = { 'twitch-eventsub-message-id': 'msg1', 'twitch-eventsub-message-timestamp': ts, 'twitch-eventsub-message-signature': good };
    assert.equal(verifySignature(secret, h, body), true);
    assert.equal(verifySignature(secret, { ...h, 'twitch-eventsub-message-signature': 'sha256=dead' }, body), false);
    assert.equal(verifySignature(secret, { ...h, 'twitch-eventsub-message-timestamp': '2020-01-01T00:00:00Z' }, body), false);
    assert.equal(verifySignature('', h, body), false);
    assert.equal(verifySignature(secret, {}, body), false);
    void sign;
  });
});

describe('publisher sources: runSync through pipeline', () => {
  const TMP = 'data/store.publisher-sources.test.tmp.json';
  const store = require('../src/utils/store');
  before(() => { store._useFile(TMP); });
  after(() => {
    store._useFile(null);
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  });

  const rss2 = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>VIDNEW12345</yt:videoId><title>New vid</title><published>2026-10-02T10:00:00Z</published></entry><entry><yt:videoId>VIDOLD12345</yt:videoId><title>Old vid</title><published>2026-10-01T10:00:00Z</published></entry></feed>`;
  const fakeHttp = { get: async () => ({ data: rss2 }) };
  const baseCfg = {
    announceRoleId: '', mediaRoleId: '',
    publisher: { announcementsChannelId: 'ANN', mediaChannelId: 'MED', sources: { youtube: true, tiktok: false, instagram: false, hpsb: false } },
    reposter: { youtube: [{ key: 'yt1', channelId: 'MED' }], tiktok: [], instagram: [], youtubeApiKey: '' },
    hpsb: { pollMinutes: 5, releases: {}, events: {}, posts: {} },
    webhook: {},
  };

  it('first run remembers, republish posts oldest-first, duplicates suppressed', async () => {
    const sent = [];
    const p = createPipeline({
      client: {}, config: baseCfg, log: { warn() {} },
      sender: async (ch, payload) => { sent.push({ ch, desc: payload.embeds[0].toJSON().description }); return { id: 'm' }; },
    });
    const run = p.start();
    try {
      const first = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(first.youtube.found, 2);
      assert.equal(first.youtube.posted, 0);
      const second = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(second.youtube.posted, 0);
      const rep = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp, republish: 2 });
      assert.equal(rep.youtube.posted, 2);
      assert.equal(sent.length, 2);
      assert.equal(sent[0].ch, 'MED');
      assert.ok(sent[0].desc.includes('Old vid'));
      assert.ok(sent[1].desc.includes('New vid'));
      // webhook + polling same item -> one message: manual re-ingest dedupes
      const dup = await p.ingest({ source: 'youtube', type: 'video', id: 'VIDOLD12345', title: 'Old vid' });
      assert.equal(dup.ok, false);
    } finally {
      p.stop();
      await run;
    }
  });

  it('disabled and unconfigured sources report state, never fetch', async () => {
    const p = createPipeline({ client: {}, config: baseCfg, log: { warn() {} }, sender: async () => ({ id: 'm' }) });
    const run = p.start();
    try {
      const offCfg = { ...baseCfg, publisher: { ...baseCfg.publisher, sources: { ...baseCfg.publisher.sources, youtube: false } } };
      const r1 = await runSync(p, offCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(r1.youtube.disabled, true);
      const noMap = { ...baseCfg, reposter: { ...baseCfg.reposter, youtube: [] } };
      const r2 = await runSync(p, noMap, { sources: 'youtube', http: fakeHttp });
      assert.equal(r2.youtube.unavailable, true);
      const igCfg = { ...baseCfg, publisher: { ...baseCfg.publisher, sources: { ...baseCfg.publisher.sources, instagram: true } } };
      const r3 = await runSync(p, igCfg, { sources: 'instagram' });
      assert.equal(r3.instagram.unavailable, true);
    } finally {
      p.stop();
      await run;
    }
  });

  it('baseline boot pass remembers everything, posts nothing', async () => {
    const sent = [];
    const p = createPipeline({
      client: {}, config: baseCfg, log: { warn() {} },
      sender: async (ch) => { sent.push(ch); return { id: 'm' }; },
    });
    const run = p.start();
    try {
      // Fresh pipeline (nothing seen) + baseline: even unseen items are only remembered.
      const r = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp, baseline: true });
      assert.equal(r.youtube.found, 2);
      assert.equal(r.youtube.posted, 0);
      assert.equal(sent.length, 0);
      // And the next normal pass finds nothing new (baseline persisted in-memory).
      const r2 = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(r2.youtube.posted, 0);
    } finally {
      p.stop();
      await run;
    }
  });

  it('empty fetch carries a note explaining why (not just 0)', async () => {
    const dead = { get: async () => { throw new Error('blocked by remote host'); } };
    const p = createPipeline({ client: {}, config: baseCfg, log: { warn() {} }, sender: async () => ({ id: 'm' }) });
    const run = p.start();
    try {
      const r = await runSync(p, baseCfg, { sources: 'youtube', http: dead, republish: 5 });
      assert.equal(r.youtube.found, 0);
      assert.ok(r.youtube.note && r.youtube.note.includes('blocked by remote host'));
    } finally {
      p.stop();
      await run;
    }
  });

  it('missing mode reposts what the channel lost (seen-memory ignored)', async () => {
    const sent = [];
    // Channel history contains only the NEW video -- OLD was wiped with the channel.
    const history = [
      { content: '', embeds: [{ url: 'https://www.youtube.com/watch?v=VIDNEW12345', title: 'New vid', description: '' }], components: [] },
    ];
    const fakeClient = {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          messages: { fetch: async () => history },
        }),
      },
    };
    const p = createPipeline({
      client: {}, config: baseCfg, log: { warn() {} },
      sender: async (ch, payload) => { sent.push(payload.embeds[0].toJSON().description); return { id: 'm' }; },
    });
    const run = p.start();
    try {
      // Baseline first: everything remembered (simulates pre-wipe state).
      await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      // Normal sync: nothing new -> posted 0.
      const normal = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(normal.youtube.posted, 0);
      // Missing mode: OLD is gone from the channel -> reposted oldest-first.
      const miss = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp, missing: true, missingLimit: 25, client: fakeClient });
      assert.equal(miss.youtube.found, 2);
      assert.equal(miss.youtube.posted, 1);
      assert.equal(sent.length, 1);
      assert.ok(sent[0].includes('Old vid'));
    } finally {
      p.stop();
      await run;
    }
  });

  it('missing mode refuses blind repost when history is unreadable', async () => {
    const sent = [];
    const blindClient = { channels: { fetch: async () => null } };
    const p = createPipeline({
      client: {}, config: baseCfg, log: { warn() {} },
      sender: async () => { sent.push(1); return { id: 'm' }; },
    });
    const run = p.start();
    try {
      const r = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp, missing: true, client: blindClient });
      assert.equal(r.youtube.posted, 0);
      assert.ok(r.youtube.error && r.youtube.error.includes('history'));
      assert.equal(sent.length, 0);
    } finally {
      p.stop();
      await run;
    }
  });

  it('discord source override beats .env, reset restores', async () => {
    const { setSourceOverride, resetSourceOverride, isSourceOn, effectiveSources } = require('../src/modules/publisher/source-state');
    const p = createPipeline({ client: {}, config: baseCfg, log: { warn() {} }, sender: async () => ({ id: 'm' }) });
    const run = p.start();
    try {
      // No override: cfg says on.
      assert.equal(isSourceOn('youtube'), true);
      await setSourceOverride('youtube', false);
      assert.equal(isSourceOn('youtube'), false);
      assert.equal(effectiveSources().youtube, false);
      const r = await runSync(p, baseCfg, { sources: 'youtube', http: fakeHttp });
      assert.equal(r.youtube.disabled, true);
      // Override on beats cfg-level off.
      const cfgOff = { ...baseCfg, publisher: { ...baseCfg.publisher, sources: { ...baseCfg.publisher.sources, youtube: false } } };
      await setSourceOverride('youtube', true);
      const r2 = await runSync(p, cfgOff, { sources: 'youtube', http: fakeHttp });
      assert.ok(!r2.youtube.disabled, 'override on must beat cfg off');
      assert.equal(r2.youtube.found, 2);
      await resetSourceOverride('youtube');
      assert.equal(isSourceOn('youtube'), true); // real .env PUBLISHER_YOUTUBE=on
      await assert.rejects(setSourceOverride('nope', true), /unknown source/);
    } finally {
      const { resetSourceOverride: reset } = require('../src/modules/publisher/source-state');
      await reset('youtube').catch(() => {});
      p.stop();
      await run;
    }
  });
});
