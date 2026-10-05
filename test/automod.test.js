const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { handleMessage } = require('../src/modules/honeypot/detector');
const { config } = require('../src/config');

config.automod.badwords = ['ass'];
config.automod.floodCount = 100;
config.automod.floodSecs = 30;
config.honeypot.trapChannelId = 'TRAP';
config.modRoleId = 'MODROLE';
config.adminIds = [];

function mockMember({ id = 'u1', bot = false, manage = false, roles = [] } = {}) {
  const calls = { timeout: 0, ban: 0, kick: 0 };
  return {
    calls, id, user: { bot, id },
    permissions: { has: () => manage },
    roles: { cache: new Map(roles.map(r => [r, true])), highest: { position: 1 } },
    timeout: async () => { calls.timeout++; },
    ban: async () => { calls.ban++; },
    kick: async () => { calls.kick++; },
  };
}
function mockMsg({ content = '', member = null, authorId = 'u1', channelId = 'general', mentions = null } = {}) {
  let deleted = false;
  return {
    msg: {
      content, channelId, guildId: 'g1',
      author: { id: authorId, send: async () => {} },
      member, mentions: mentions || { everyone: false, users: { size: 0 } },
      delete: async () => { deleted = true; },
    },
    wasDeleted: () => deleted,
  };
}
const sentLogs = [];
const client = {
  channels: { fetch: async () => ({ isTextBased: () => true, send: async (t) => { sentLogs.push(t); } }) },
  fetchInvite: async () => ({ guildId: 'g1' }),
};

describe('automod', () => {
  beforeEach(() => { sentLogs.length = 0; });
  it('badwords use word boundaries (class ok, ass hit)', async () => {
    const m1 = mockMember();
    const x1 = mockMsg({ content: 'i love my class project', member: m1 });
    await handleMessage(x1.msg, client);
    assert.equal(m1.calls.timeout, 0);
    const m2 = mockMember({ id: 'u2' });
    const x2 = mockMsg({ content: 'you are an ass', member: m2, authorId: 'u2' });
    await handleMessage(x2.msg, client);
    assert.equal(m2.calls.timeout, 1);
  });
  it('caps unicode deletes without mute', async () => {
    const m = mockMember({ id: 'u3' });
    const x = mockMsg({ content: 'ÕÄÖÜ TERE ÕHTU KÕIK ON VÄGA HEA', member: m, authorId: 'u3' });
    await handleMessage(x.msg, client);
    assert.equal(x.wasDeleted(), true);
    assert.equal(m.calls.timeout, 0);
  });
  it('trap exempts mod role, hits normal user', async () => {
    const m4 = mockMember({ id: 'u4', roles: ['MODROLE'] });
    await handleMessage(mockMsg({ content: 'hi', member: m4, authorId: 'u4', channelId: 'TRAP' }).msg, client);
    assert.equal(m4.calls.timeout, 0);
    const m5 = mockMember({ id: 'u5' });
    await handleMessage(mockMsg({ content: 'hi', member: m5, authorId: 'u5', channelId: 'TRAP' }).msg, client);
    assert.equal(m5.calls.timeout, 1);
  });
  it('own-guild invite is allowed', async () => {
    const m = mockMember({ id: 'u6' });
    await handleMessage(mockMsg({ content: 'join https://discord.gg/abc123', member: m, authorId: 'u6' }).msg, client);
    assert.equal(m.calls.timeout, 0);
  });
  it('flood mutes after threshold', async () => {
    config.automod.floodCount = 3;
    const m = mockMember({ id: 'u7' });
    for (let i = 0; i < 5; i++) await handleMessage(mockMsg({ content: 'msg ' + i, member: m, authorId: 'u7' }).msg, client);
    assert.ok(m.calls.timeout >= 1);
    config.automod.floodCount = 100;
  });
  it('scam words without link delete without mute', async () => {
    const m = mockMember({ id: 'u8' });
    const x = mockMsg({ content: 'my steamcommunity gift trade history', member: m, authorId: 'u8' });
    await handleMessage(x.msg, client);
    assert.equal(x.wasDeleted(), true);
    assert.equal(m.calls.timeout, 0);
  });
  it('gif hosts are whitelisted', async () => {
    const m = mockMember({ id: 'u9' });
    await handleMessage(mockMsg({ content: 'lol https://tenor.com/view/x https://giphy.com/y', member: m, authorId: 'u9' }).msg, client);
    assert.equal(m.calls.timeout, 0);
  });
});
