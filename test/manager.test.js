const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createManager, defaultManifests } = require('../src/modules/manager');
const { parseSwitch } = require('../src/config');

function fakeManifests(calls) {
  return [
    { name: 'a', label: 'A', dependsOn: [], start: async () => { calls.push('start:a'); }, stop: async () => { calls.push('stop:a'); } },
    { name: 'b', label: 'B', dependsOn: ['a'], start: async () => { calls.push('start:b'); }, stop: async () => { calls.push('stop:b'); } },
    { name: 'boom', label: 'Boom', dependsOn: [], start: async () => { throw new Error('kaput'); } },
  ];
}

describe('module manager', () => {
  it('parseSwitch handles on/off variants', () => {
    assert.equal(parseSwitch('on'), true);
    assert.equal(parseSwitch('OFF'), false);
    assert.equal(parseSwitch('1'), true);
    assert.equal(parseSwitch('0'), false);
    assert.equal(parseSwitch('true'), true);
    assert.equal(parseSwitch('false'), false);
    assert.equal(parseSwitch('', true), true);
    assert.equal(parseSwitch(undefined, false), false);
    assert.equal(parseSwitch('garbage', true), true);
  });
  it('disabled module does not start', async () => {
    const calls = [];
    const m = createManager({ manifests: fakeManifests(calls), isEnabledFn: () => false });
    assert.equal(await m.start('a', {}), false);
    assert.deepEqual(calls, []);
  });
  it('enabled module starts, stop works, restart re-runs', async () => {
    const calls = [];
    const m = createManager({ manifests: fakeManifests(calls), isEnabledFn: () => true });
    assert.equal(await m.start('a', {}), true);
    assert.equal(await m.start('a', {}), true); // idempotent, no duplicate start
    assert.equal(await m.stop('a', {}), true);
    assert.deepEqual(calls, ['start:a', 'stop:a']);
    await m.restart('a', {});
    assert.deepEqual(calls, ['start:a', 'stop:a', 'stop:a', 'start:a']);
  });
  it('dependency blocks startup when dep disabled', async () => {
    const calls = [];
    const m = createManager({ manifests: fakeManifests(calls), isEnabledFn: (n) => n !== 'a' });
    assert.equal(await m.start('b', {}), false);
    assert.deepEqual(calls, []);
  });
  it('one failing module does not stop startAll', async () => {
    const calls = [];
    const m = createManager({ manifests: fakeManifests(calls), isEnabledFn: () => true });
    await m.startAll({});
    assert.deepEqual(calls, ['start:a', 'start:b']);
    const st = m.status();
    assert.equal(st.find(s => s.name === 'a').running, true);
    assert.equal(st.find(s => s.name === 'b').running, true);
  });
  it('unknown module throws', async () => {
    const m = createManager({ manifests: fakeManifests([]), isEnabledFn: () => true });
    await assert.rejects(() => m.start('nope', {}), /unknown module/);
    await assert.rejects(() => m.stop('nope', {}), /unknown module/);
  });
  it('default registry has all modules, no deps cycles', () => {
    const list = defaultManifests();
    const names = list.map(m => m.name).sort();
    assert.deepEqual(names, ['automod', 'honeypot', 'modcall', 'music', 'private', 'publisher', 'stats']);
    for (const m of list) {
      assert.ok(typeof m.start === 'function', m.name);
      for (const d of m.dependsOn || []) assert.ok(names.includes(d), `${m.name} dep ${d}`);
    }
  });
});
