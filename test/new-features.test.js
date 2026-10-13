const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

describe('roundup: save button + threads + top + notices + backups', () => {
  const TMP = 'data/store.roundup.test.tmp.json';
  const store = require('../src/utils/store');
  before(() => { store._useFile(TMP); });
  after(() => {
    store._useFile(null);
    if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
  });

  it('extractPostUrl prefers watch links over thumbnails', () => {
    const { extractPostUrl } = require('../src/modules/publisher/save');
    const msg = {
      embeds: [{ url: 'https://example.com/post', title: '**[Hit](https://www.youtube.com/watch?v=VID12345678)**', description: 'thumb https://i.ytimg.com/vi/VID12345678/hqdefault.jpg' }],
      components: [{ components: [{ url: 'https://www.youtube.com/watch?v=VID12345678' }] }],
    };
    assert.equal(extractPostUrl(msg), 'https://www.youtube.com/watch?v=VID12345678');
    assert.equal(extractPostUrl({}), '');
  });

  it('media formats are saveable, releases are not', () => {
    const { format } = require('../src/modules/publisher/formatter');
    assert.equal(format({ source: 'youtube', type: 'video', id: 'v', title: 'T' }).saveable, true);
    assert.equal(format({ source: 'tiktok', type: 'video', id: 'v', title: 'T' }).saveable, true);
    assert.ok(!format({ source: 'hpsb', type: 'release', id: 'r', title: 'R' }).saveable);
  });

  it('pipeline adds pub:save row on media and threads on releases', async () => {
    const { createPipeline } = require('../src/modules/publisher/pipeline');
    const cfg = {
      announceRoleId: '', mediaRoleId: '',
      publisher: { announcementsChannelId: 'ANN', mediaChannelId: 'MED' },
      hpsb: { releases: { threads: true } },
    };
    const sent = [];
    const threads = [];
    const p = createPipeline({
      client: {}, config: cfg, log: { warn() {} },
      sender: async (ch, payload) => {
        sent.push({ ch, payload });
        return { id: 'm1', startThread: async (o) => { threads.push(o); return {}; } };
      },
    });
    const run = p.start();
    try {
      await p.ingest({ source: 'youtube', type: 'video', id: 'VIDSAVE1234', title: 'T', url: 'https://www.youtube.com/watch?v=VIDSAVE1234' });
      await p.queue.onIdle();
      const media = sent.find((s) => s.ch === 'MED');
      assert.ok(media, 'media posted');
      const flat = media.payload.components.flatMap((r) => (r.components || []).map((b) => b.data || b));
      assert.ok(flat.some((b) => b.custom_id === 'pub:save'), 'save button present');
      await p.ingest({ source: 'hpsb', type: 'release', id: 'rel1', title: 'Big Release' });
      await p.queue.onIdle();
      assert.equal(threads.length, 1);
      assert.ok(threads[0].name.includes('Big Release'));
    } finally {
      p.stop();
      await run;
    }
  });

  it('computeTopRoles ranks and skips @everyone', () => {
    const { computeTopRoles } = require('../src/commands/top');
    const names = new Map([['g', 'everyone'], ['r1', 'DJ'], ['r2', 'Fan']]);
    const members = [
      { roles: ['g', 'r1'] }, { roles: ['g', 'r1'] }, { roles: ['g', 'r2'] }, { roles: ['g'] },
    ];
    const top = computeTopRoles(members, names, 'g', 5);
    assert.deepEqual(top.map((r) => [r.name, r.n]), [['DJ', 2], ['Fan', 1]]);
  });

  it('unmute notice is recorded and DM fires (overdue delivered on boot)', async () => {
    const det = require('../src/modules/honeypot/detector');
    const dms = [];
    const client = {
      guilds: { fetch: async () => ({ name: 'Test Guild' }) },
      users: { fetch: async () => ({ send: async (t) => { dms.push(t); } }) },
    };
    await det.scheduleUnmuteNotice(client, 'g1', 'u-notice-1', 30);
    const stored = store.load().honeypotNotices || {};
    assert.ok(stored['u-notice-1'] && stored['u-notice-1'].at > Date.now());
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(dms.length, 1);
    assert.ok(dms[0].includes('expired'));
    assert.ok(!store.load().honeypotNotices?.['u-notice-1'], 'consumed after delivery');
    // Overdue at boot goes out immediately.
    await det.scheduleUnmuteNotice(client, 'g1', 'u-notice-2', 30);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(dms.length, 2);
  });

  it('store backups rotate (keep N)', () => {
    const { doBackup } = require('../src/utils/backup');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpsb-bak-'));
    const src = path.join(dir, 'store.json');
    fs.writeFileSync(src, '{"a":1}');
    for (let i = 0; i < 12; i++) {
      const r = doBackup(src, path.join(dir, 'backups'), 10);
      assert.equal(r.ok, true);
    }
    const kept = fs.readdirSync(path.join(dir, 'backups'));
    assert.ok(kept.length <= 10, `kept ${kept.length}`);
    assert.equal(doBackup(path.join(dir, 'nope.json'), path.join(dir, 'backups')).ok, false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
