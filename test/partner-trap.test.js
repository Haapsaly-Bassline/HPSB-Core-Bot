const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLinks, buildPost } = require('../src/commands/partner-post');
const play = require('../src/commands/play');

describe('partner-post modal helpers', () => {
  it('parseLinks accepts pipe lines, skips garbage, caps at 5', () => {
    const got = parseLinks([
      'Roblox | https://roblox.com/x',
      'Website | https://example.com',
      'garbage line without url',
      'Bad | not-a-url',
      'Instagram | https://instagram.com/x',
      'Youtube | https://youtube.com/x',
      'Discord | https://discord.gg/x',
      'Extra | https://extra.example/',
    ].join('\n'));
    assert.deepEqual(got.map((l) => l.label), ['Roblox', 'Website', 'Instagram', 'Youtube', 'Discord']);
    assert.deepEqual(parseLinks(''), []);
  });
  it('modal builds within Discord limits (labels <= 45)', async () => {
    const cmd = require('../src/commands/partner-post');
    const { config } = require('../src/config');
    const oldPartners = config.publisher.partnersChannelId;
    config.publisher.partnersChannelId = '123';
    let shown = null;
    const interaction = {
      user: { id: '743817824664944721' },
      memberPermissions: { has: () => true },
      member: { roles: { cache: new Map() } },
      showModal: async (m) => { shown = m.toJSON(); },
      reply: async () => {},
    };
    try {
      await cmd.execute(interaction, {});
    } finally {
      config.publisher.partnersChannelId = oldPartners;
    }
    assert.ok(shown, 'showModal must be called');
    assert.equal(shown.components.length, 5);
    for (const row of shown.components) {
      for (const input of row.components) {
        assert.ok((input.label || '').length <= 45, `label too long: ${input.label}`);
      }
    }
  });
  it('buildPost is a Components-V2 container like the reference', () => {
    const { MessageFlags } = require('discord.js');
    const { data, files } = buildPost({
      name: 'Hearkken',
      tagline: 'Creating and recreating the best stages around the globe',
      links: [
        { label: 'Roblox', url: 'https://roblox.com/x' },
        { label: 'Website', url: 'https://example.com' },
        { label: 'Instagram', url: 'https://instagram.com/x' },
        { label: 'Youtube', url: 'https://youtube.com/x' },
      ],
      started: 'january 23, 2026',
      banner: null,
      image: 'https://example.com/banner.png',
    });
    assert.deepEqual(data.flags, [MessageFlags.IsComponentsV2]);
    assert.equal(files.length, 0);
    const c = data.components[0].toJSON();
    assert.equal(c.type, 17); // container
    const texts = c.components.filter((x) => x.type === 10).map((x) => x.content).join('\n');
    assert.ok(texts.includes('Hearkken x HPSB (Partnership)'));
    assert.ok(texts.includes('Find us on:'));
    assert.ok(texts.includes('january 23, 2026'));
    assert.ok(!texts.includes('today at') && !texts.includes('Сегодня'));
    const gallery = c.components.find((x) => x.type === 12); // media gallery
    assert.ok(gallery, 'banner gallery present');
    assert.equal(gallery.items[0].media.url, 'https://example.com/banner.png');
    const rows = c.components.filter((x) => x.type === 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].components.length, 4);
    assert.ok(rows[0].components.every((b) => b.type === 2 && b.style === 5)); // link buttons
    assert.ok(c.components.some((x) => x.type === 14)); // separator divider
  });
  it('buildPost tolerates a garbage banner (no gallery, never throws)', () => {
    const { data } = buildPost({ name: 'X', tagline: 'Y', image: 'not-a-url', links: [], started: '', banner: null });
    const c = data.components[0].toJSON();
    assert.ok(!c.components.some((x) => x.type === 12));
  });
  it('buildPost prefers the re-uploaded banner ref', () => {
    const { data, files } = buildPost({
      name: 'X', tagline: 'Y', image: 'https://example.com/banner.png', links: [], started: '',
      banner: { file: { name: 'banner.png' }, ref: 'attachment://banner.png' },
    });
    const gallery = data.components[0].toJSON().components.find((x) => x.type === 12);
    assert.equal(gallery.items[0].media.url, 'attachment://banner.png');
    assert.equal(files.length, 1);
  });
  it('handleModal re-hosts the banner as an attachment (mocked fetch)', async () => {
    const cmd = require('../src/commands/partner-post');
    const { config } = require('../src/config');
    const oldPartners = config.publisher.partnersChannelId;
    config.publisher.partnersChannelId = '555';
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: (h) => (h === 'content-type' ? 'image/png' : h === 'content-length' ? String(pixel.length) : null) },
      arrayBuffer: async () => pixel,
    });
    const values = { 'pp-name': 'Water Wolf', 'pp-tagline': 'Friendly VR hangout', 'pp-image': 'https://example.com/banner.png', 'pp-links': 'Website | https://example.com', 'pp-started': 'january 1, 2026' };
    let payload = null;
    let confirm = '';
    let deferred = false;
    const interaction = {
      user: { id: '743817824664944721' },
      memberPermissions: { has: () => true },
      member: { roles: { cache: new Map() } },
      fields: { getTextInputValue: (id) => values[id] },
      deferReply: async () => { deferred = true; },
      editReply: async (m) => { confirm = m.content || ''; },
      reply: async () => { throw new Error('must defer, not reply'); },
    };
    const client = {
      channels: {
        fetch: async () => ({
          isTextBased: () => true, type: 0,
          send: async (p) => { payload = p; return { url: 'https://discord.com/x' }; },
        }),
      },
    };
    try {
      await cmd.handleModal(interaction, client);
    } finally {
      globalThis.fetch = realFetch;
      config.publisher.partnersChannelId = oldPartners;
    }
    assert.equal(deferred, true);
    assert.ok(payload.files && payload.files.length === 1, 'banner attached');
    const top = payload.components[0].toJSON();
    assert.equal(top.type, 17);
    const gallery = top.components.find((x) => x.type === 12);
    assert.equal(gallery.items[0].media.url, 'attachment://banner.png');
    assert.ok(payload.flags.includes(32768), 'IsComponentsV2 flag');
    assert.ok(confirm.includes('re-uploaded'));
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

  it('trap warning never duplicates (banner-only recent -> embed only)', async () => {
    const sent = [];
    const recent = [
      { author: { id: 'self-bot' }, content: 'https://example.com/banner.png', embeds: [] },
    ];
    const client = {
      user: { id: 'self-bot' },
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          messages: { fetch: async () => recent },
          send: async (p) => { sent.push(p); return {}; },
        }),
      },
    };
    const oldTrap = config.honeypot.trapChannelId;
    const oldBanner = config.honeypot.bannerUrl;
    config.honeypot.trapChannelId = 'TRAP-WARN2';
    config.honeypot.bannerUrl = 'https://example.com/banner.png';
    try {
      await det.ensureTrapWarning(client);
    } finally {
      config.honeypot.trapChannelId = oldTrap;
      config.honeypot.bannerUrl = oldBanner;
    }
    assert.equal(sent.length, 1);
    assert.ok(sent[0].embeds);
  });

  it('softban stuck (ban ok, unban fails) reports failure, never fake-kick', async () => {
    const calls = { ban: 0, kick: 0, unban: 0 };
    const logs = [];
    const msg = {
      channelId: 'general', content: 'spam',
      author: { id: 'spammer2', bot: false, send: async () => {} },
      member: {
        id: 'spammer2', user: { bot: false },
        ban: async () => { calls.ban++; },
        kick: async () => { calls.kick++; },
      },
      guild: { members: { unban: async () => { calls.unban++; throw new Error('no perms'); } } },
      delete: async () => {},
    };
    const client = {
      user: { id: 'self-bot' },
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (t) => { logs.push(t); return {}; } }) },
    };
    const oldTrap = config.honeypot.trapChannelId;
    const oldAdmins = config.adminIds;
    const oldAction = config.honeypot.action;
    config.honeypot.trapChannelId = 'TRAP-STUCK';
    config.adminIds = [];
    config.honeypot.action = 'kick';
    let ok = true;
    try {
      ok = await det.handleMessage({ ...msg, channelId: 'TRAP-STUCK' }, client);
    } finally {
      config.honeypot.trapChannelId = oldTrap;
      config.adminIds = oldAdmins;
      config.honeypot.action = oldAction;
    }
    assert.equal(ok, undefined); // handleMessage returns nothing; punish result is in logs
    assert.equal(calls.ban, 1);
    assert.equal(calls.kick, 0); // must NOT fake a kick after a stuck ban
    assert.ok(logs.some((t) => String(t).includes('FAILED') && String(t).includes('STUCK')));
  });

  it('isExempt is the single source of truth (kick/ban perms exempt)', async () => {
    const { PermissionFlagsBits } = require('discord.js');
    const { isExempt } = det;
    const mk = (perms) => ({ user: { bot: false }, permissions: { has: (f) => perms.includes(f) }, roles: { cache: new Map() } });
    assert.equal(isExempt(mk([PermissionFlagsBits.KickMembers]), 'u1'), true);
    assert.equal(isExempt(mk([PermissionFlagsBits.BanMembers]), 'u1'), true);
    assert.equal(isExempt(mk([PermissionFlagsBits.SendMessages]), 'u1'), false);
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
        guild: { id: 'g1' },
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
