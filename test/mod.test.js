const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { requireMod, requirePower, protectedTarget, replyError } = require('../src/utils/mod');
const { config } = require('../src/config');

config.modRoleId = 'MODROLE';
config.adminIds = ['owner1'];

function mockIx({ uid = 'actor', perms = [], roles = [5], modRole = false } = {}) {
  const replied = [];
  const roleMap = new Map();
  for (const r of roles) roleMap.set(r, 1);
  if (modRole) roleMap.set('MODROLE', 1);
  return {
    user: { id: uid },
    member: {
      id: uid,
      roles: { cache: roleMap, highest: { position: Math.max(...roles) } },
    },
    memberPermissions: { has: (f) => perms.includes(f) },
    replied: false, deferred: false,
    reply: async (p) => { replied.push(p); },
    _replied: replied,
  };
}
function mockMember({ id = 't1', pos = 1, admin = false, ownerId = 'owner9' } = {}) {
  return { id, guild: { ownerId }, permissions: { has: () => admin }, roles: { cache: new Map(), highest: { position: pos } } };
}
const bot = { roles: { highest: { position: 10 } } };

describe('mod gates', () => {
  it('requireMod accepts perm, role, denies stranger', async () => {
    assert.equal(await requireMod(mockIx({ perms: [P.ManageMessages] })), true);
    assert.equal(await requireMod(mockIx({ perms: [], modRole: true })), true);
    assert.equal(await requireMod(mockIx({ perms: [] })), false);
  });
  it('requirePower is strict for destructive actions', async () => {
    assert.equal(await requirePower(mockIx({ perms: [P.ManageMessages] }), P.BanMembers, 'Ban'), false);
    assert.equal(await requirePower(mockIx({ perms: [P.BanMembers] }), P.BanMembers, 'Ban'), true);
    assert.equal(await requirePower(mockIx({ perms: [P.Administrator] }), P.BanMembers, 'Ban'), true);
    assert.equal(await requirePower(mockIx({ perms: [], modRole: true }), P.BanMembers, 'Ban'), false);
  });
  it('protectedTarget blocks self/owner/admin/senior/equal/above-bot', () => {
    const actor = mockMember({ id: 'actor', pos: 5 });
    assert.ok(protectedTarget(mockMember({ id: 'actor', pos: 1 }), actor, bot));
    assert.ok(protectedTarget({ ...mockMember({ pos: 1 }), id: 'x', guild: { ownerId: 'x' } }, actor, bot));
    assert.ok(protectedTarget(mockMember({ id: 'x', pos: 1, admin: true }), actor, bot));
    assert.ok(protectedTarget(mockMember({ id: 'x', pos: 7 }), actor, bot));
    assert.ok(protectedTarget(mockMember({ id: 'x', pos: 5 }), actor, bot));
    assert.ok(protectedTarget(mockMember({ id: 'x', pos: 12 }), actor, bot));
    assert.ok(protectedTarget(null, actor, bot));
    assert.equal(protectedTarget(mockMember({ id: 'x', pos: 3 }), actor, bot), null);
  });
  it('replyError respects deferred state without throwing', async () => {
    const d = mockIx(); d.deferred = true; d.editReply = async () => { d._replied.push('edit'); };
    await replyError(d, 'x');
    assert.equal(d._replied[0], 'edit');
  });
});
