const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLinks, buildPost } = require('../src/commands/partner-post');
const play = require('../src/commands/play');

describe('partner-post modal helpers', () => {
  it('parseLinks accepts pipe lines, skips garbage, caps at 4', () => {
    const got = parseLinks([
      'Roblox | https://roblox.com/x',
      'Website | https://example.com',
      'garbage line without url',
      'Bad | not-a-url',
      'Instagram | https://instagram.com/x',
      'Youtube | https://youtube.com/x',
      'Extra | https://extra.example/',
    ].join('\n'));
    assert.deepEqual(got.map((l) => l.label), ['Roblox', 'Website', 'Instagram', 'Youtube']);
    assert.deepEqual(parseLinks(''), []);
  });
  it('buildPost matches the partner card shape', () => {
    const { embed, components } = buildPost({
      name: 'Hearkken',
      tagline: 'Creating and recreating the best stages around the globe',
      image: 'https://example.com/banner.png',
      links: [{ label: 'Roblox', url: 'https://roblox.com/x' }, { label: 'Website', url: 'https://example.com' }],
      started: 'january 23, 2026',
    });
    const j = embed.toJSON();
    assert.ok(j.title.includes('Hearkken') && j.title.includes('Partnership'));
    assert.ok(j.description.includes('Find us on:'));
    assert.equal(j.image.url, 'https://example.com/banner.png');
    assert.ok(j.footer.text.includes('january 23, 2026'));
    assert.equal(components.length, 1);
    assert.equal(components[0].components.length, 2);
  });
});

describe('honeypot kick = softban (reference behavior)', () => {
  const det = require('../src/modules/honeypot/detector');
  const { config } = require('../src/config');

  it('kick bans with 24h wipe + unbans + deletes the message', async () => {
    const calls = { ban: [], unban: 0, kick: 0, deleted: false };
    const msg = {
      channelId: 'general', content: 'spam',
      author: { id: 'spammer', bot: false, send: async () => {} },
      member: {
        id: 'spammer', user: { bot: false },
        ban: async (opts) => { calls.ban.push(opts); },
        kick: async () => { calls.kick++; },
      },
      guild: { members: { unban: async () => { calls.unban++; } } },
      delete: async () => { calls.deleted = true; },
    };
    const client = {
      user: { id: 'self-bot' },
      channels: { fetch: async () => ({ isTextBased: () => true, send: async () => ({}) }) },
    };
    // punish() is not exported; drive it through the trap channel path.
    // Force the kick action explicitly so the test is .env-independent.
    const oldTrap = config.honeypot.trapChannelId;
    const oldAdmins = config.adminIds;
    const oldAction = config.honeypot.action;
    config.honeypot.trapChannelId = 'TRAP-KICK';
    config.adminIds = [];
    config.honeypot.action = 'kick';
    try {
      await det.handleMessage({ ...msg, channelId: 'TRAP-KICK' }, client);
    } finally {
      config.honeypot.trapChannelId = oldTrap;
      config.adminIds = oldAdmins;
      config.honeypot.action = oldAction;
    }
    assert.equal(calls.ban.length, 1);
    assert.equal(calls.ban[0].deleteMessageSeconds, 86400);
    assert.equal(calls.unban, 1);
    assert.equal(calls.kick, 0);
    assert.equal(calls.deleted, true);
  });

  it('trap warning posts banner image first, warning embed second', async () => {
    const sent = [];
    const client = {
      user: { id: 'self-bot' },
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          messages: { fetch: async () => [] },
          send: async (p) => { sent.push(p); return {}; },
        }),
      },
    };
    const oldTrap = config.honeypot.trapChannelId;
    const oldBanner = config.honeypot.bannerUrl;
    config.honeypot.trapChannelId = 'TRAP-WARN';
    config.honeypot.bannerUrl = 'https://example.com/banner.png';
    try {
      await det.ensureTrapWarning(client);
    } finally {
      config.honeypot.trapChannelId = oldTrap;
      config.honeypot.bannerUrl = oldBanner;
    }
    assert.equal(sent.length, 2);
    assert.equal(sent[0], 'https://example.com/banner.png');
    assert.ok(Array.isArray(sent[1].embeds) && sent[1].embeds.length === 1);
  });
});
describe('play command absorbs bandcamp-fan', () => {
  it('has query + channel + count options', () => {
    const j = play.data.toJSON();
    const names = j.options.map((o) => o.name).sort();
    assert.deepEqual(names, ['channel', 'count', 'query']);
  });
});

describe('honeypot trap acts on bots', () => {
  const { config } = require('../src/config');
  const det = require('../src/modules/honeypot/detector');

  function mockMsg(authorId, bot, channelId) {
    const deleted = { v: false };
    return {
      msg: {
        channelId, content: 'raid spam',
        author: { id: authorId, bot },
        member: {
          id: authorId, user: { bot },
          ban: async () => {}, kick: async () => {}, timeout: async () => {},
        },
        delete: async () => { deleted.v = true; },
      },
      deleted,
    };
  }
  function mockClient(logSink) {
    return {
      user: { id: 'self-bot' },
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (p) => { logSink.push(p); return {}; } }) },
    };
  }

  it('ignores wrong channel and own warning', async () => {
    const logs = [];
    assert.equal(await det.handleTrapMessage(mockMsg('b1', true, 'nope').msg, mockClient(logs)), false);
    assert.equal(logs.length, 0);
  });

  it('punishes a bot posting in the trap channel', async () => {
    if (!config.honeypot.trapChannelId) return; // no trap configured locally
    const logs = [];
    const { msg, deleted } = mockMsg('raid-bot-1', true, config.honeypot.trapChannelId);
    const ok = await det.handleTrapMessage(msg, mockClient(logs));
    assert.equal(ok, true);
    assert.equal(deleted.v, true);
    assert.ok(logs.length > 0);
  });

  it('never punishes itself', async () => {
    if (!config.honeypot.trapChannelId) return;
    const logs = [];
    const { msg } = mockMsg('self-bot', true, config.honeypot.trapChannelId);
    assert.equal(await det.handleTrapMessage(msg, mockClient(logs)), false);
    assert.equal(logs.length, 0);
  });
});
