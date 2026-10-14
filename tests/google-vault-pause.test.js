import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual account presenter with a bounded DOM/bridge fixture; no account data or browser is opened.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const initialize = source.slice(source.indexOf('async function initializeGoogle()'), source.indexOf('function renderGoogleAccess()'));
const presenter = source.slice(source.indexOf('function renderGoogleAccess()'), source.indexOf('// The account chip'));
const synchronize = source.slice(source.indexOf('async function syncGoogle('), source.indexOf('async function changeGoogleAccount('));
const changeAccount = source.slice(source.indexOf('async function changeGoogleAccount('), source.indexOf('function resetPlan()'));

async function fixture(profileId, account) {
  const nodes = new Map(); const timers = []; const syncs = []; let immediate = 0;
  const context = vm.createContext({
    profileId, googleAccount: null, syncTimer: null, syncService: null,
    native: { info: { profileId }, bridge: { request: async method => { assert.equal(method, 'google.status'); return account; } } },
    workspace: { state: {} }, storage: {},
    $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    clearInterval() {}, setInterval: (callback, delay) => { timers.push({ callback, delay }); return 1; }, addEventListener() {},
    renderAccount() {}, setSync: (...args) => syncs.push(args), syncGoogle: async () => { immediate++; },
    changeGoogleAccount() {}, askResumeCloudRestore() {},
    NativeGoogleFileStore: class { constructor(bridge, info, accountId) { assert.equal(info.profileId, `google:${accountId}`); } },
    FileSync: class {},
  });
  await vm.runInContext(`${presenter}\n${initialize}\ninitializeGoogle()`, context);
  return { nodes, timers, syncs, immediate, context };
}

test('locked vault keeps offline Google notes and a retry route without suggesting reauthentication', async () => {
  const f = await fixture('google:fixture', { configured: true, connected: false, accountId: 'fixture', paused: true, pauseReason: '系統金鑰圈已鎖定' });
  assert.equal(f.nodes.get('#google-value').textContent, '同步暫停');
  assert.equal(f.nodes.get('#google-sign-in').textContent, '切換帳號');
  assert.equal(f.nodes.get('#google-sync').textContent, '立即同步');
  assert.equal(f.nodes.get('#sync-row').hidden, false);
  assert.equal(f.nodes.get('#google-sign-out').hidden, false);
  assert.equal(f.immediate, 0);
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 20000);
  assert.equal(f.syncs[0][0], 'attention');
  await f.nodes.get('#google-sync').onclick();
  assert.equal(f.context.googleAccount.accountId, 'fixture');
});

test('unlock status updates the same account controls without starting OAuth', async () => {
  const f = await fixture('google:fixture', { configured: true, connected: false, accountId: 'fixture', paused: true });
  f.context.googleAccount = { configured: true, connected: true, accountId: 'fixture', email: 'synthetic@example.test', paused: false };
  vm.runInContext('renderGoogleAccess()', f.context);
  assert.equal(f.nodes.get('#google-value').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#google-sign-in').textContent, '切換帳號');
  assert.equal(f.nodes.get('#sync-row').hidden, false);
});

test('hosts without optional vault pause fields retain connected and signed-out behaviour', async () => {
  const connected = await fixture('google:fixture', { configured: true, connected: true, accountId: 'fixture', email: 'synthetic@example.test' });
  assert.equal(connected.immediate, 1);
  const local = await fixture('local', { configured: true, connected: false });
  assert.equal(local.nodes.get('#google-value').textContent, '未登入');
  assert.equal(local.nodes.get('#sync-row').hidden, true);
  assert.equal(local.timers.length, 0);
});

function syncFixture({ capability = true, unlock, sync } = {}) {
  const nodes = new Map(); const calls = []; const states = [];
  const account = { configured: true, connected: true, paused: false, accountId: 'fixture', email: 'synthetic@example.test' };
  const context = vm.createContext({
    profileId: 'google:fixture', googleAccount: { ...account, connected: false, paused: true },
    native: { info: { capabilities: { vaultUnlock: capability } }, bridge: { request: async method => {
      assert.equal(method, 'google.unlockVault'); calls.push(method); return unlock ? unlock() : account;
    } } },
    syncService: { sync: async options => { calls.push(['sync', options.force]); if (sync) await sync(); } },
    syncBusy: false, nativeClosing: false, accountBusy: false, composing: false, dataPanel: null, desktop: null,
    document: { querySelectorAll: () => [] },
    $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    setSync: (...args) => states.push(args), renderAccount() {},
    flushDraft: async () => calls.push('flush'),
    workspace: { snapshot: { groups: [{ id: 'group' }] }, pendingOperations: [], layout: { placeNew: async () => {} } },
    activeGroups: snapshot => snapshot.groups, activeGroupId: 'group',
    controller: { reconcile: async () => {} }, workAreas: () => [], render() {},
  });
  vm.runInContext(`${presenter}\n${synchronize}`, context);
  return { nodes, calls, states, context, invoke: force => vm.runInContext(`syncGoogle(${force})`, context) };
}

test('manual sync requests native system unlock then continues the same account sync', async () => {
  const f = syncFixture();
  await f.invoke(true);
  assert.deepEqual(f.calls, ['google.unlockVault', 'flush', ['sync', true]]);
  assert.equal(f.context.googleAccount.accountId, 'fixture');
  assert.equal(f.nodes.get('#storage-note').textContent, '同步到你的 Google 帳號');
  assert.equal(f.states.at(-1)[0], 'ok');
  assert.equal(f.context.syncBusy, false);
  assert.equal(f.nodes.get('#google-sync').disabled, false);
});

test('background sync never requests unlock even when the vault is locked', async () => {
  const f = syncFixture({ sync: () => { throw Object.assign(new Error('金鑰圈已鎖住'), { code: 'vault-locked' }); } });
  await f.invoke(false);
  assert.deepEqual(f.calls, ['flush', ['sync', false]]);
  assert.equal(f.states.at(-1)[1], '同步暫停');
});

test('cancelled or timed-out unlock keeps notes paused and a later click can retry', async () => {
  for (const code of ['vault-unlock-cancelled', 'vault-unlock-timeout']) {
    let cancel = true;
    const f = syncFixture({ unlock: () => {
      if (cancel) throw Object.assign(new Error('解鎖未完成'), { code });
      return { configured: true, connected: true, accountId: 'fixture', paused: false };
    } });
    await f.invoke(true);
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(f.states.at(-1)[1], '同步暫停');
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    cancel = false;
    await f.invoke(true);
    assert.deepEqual(f.calls, ['google.unlockVault', 'google.unlockVault', 'flush', ['sync', true]]);
    assert.equal(f.states.at(-1)[0], 'ok');
  }
});

test('hosts without unlock capability sync manually without a new bridge method', async () => {
  const f = syncFixture({ capability: false });
  f.context.googleAccount.paused = false;
  await f.invoke(true);
  assert.deepEqual(f.calls, ['flush', ['sync', true]]);
});

test('repeated clicks during the system prompt produce one request and no concurrent sync', async () => {
  let resolve;
  const f = syncFixture({ unlock: () => new Promise(done => { resolve = done; }) });
  const first = f.invoke(true);
  await f.invoke(true);
  assert.deepEqual(f.calls, ['google.unlockVault']);
  resolve({ configured: true, connected: true, accountId: 'fixture', paused: false });
  await first;
  assert.deepEqual(f.calls, ['google.unlockVault', 'flush', ['sync', true]]);
});

test('account switch, local mode and sign-out discard the old unlock response before saving or syncing', async () => {
  for (const action of ['switch', 'local', 'signOut']) {
    let resolve;
    const f = syncFixture({ unlock: () => new Promise(done => { resolve = done; }) });
    const first = f.invoke(true);
    f.context.accountBusy = true;
    f.context.syncService = null;
    f.context.profileId = action === 'switch' ? 'google:other' : 'local';
    const nextAccount = { accountId: action === 'switch' ? 'other' : null };
    f.context.googleAccount = nextAccount;
    resolve({ connected: true, accountId: 'fixture' });
    await first;
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(f.context.googleAccount, nextAccount);
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.states.some(state => state[1] === '同步失敗'), false);
  }
});

test('closing the host or cancelling an old account prompt does not overwrite the next account UI', async () => {
  for (const closing of [true, false]) {
    let reject;
    const f = syncFixture({ unlock: () => new Promise((_resolve, fail) => { reject = fail; }) });
    const first = f.invoke(true);
    f.context.nativeClosing = closing;
    f.context.accountBusy = !closing;
    const nextAccount = { accountId: 'other', connected: true };
    f.context.googleAccount = nextAccount;
    reject(Object.assign(new Error('舊操作已取消'), { code: 'vault-unlock-cancelled' }));
    await first;
    assert.deepEqual(f.calls, ['google.unlockVault']);
    assert.equal(f.context.googleAccount, nextAccount);
    assert.equal(f.context.syncBusy, false);
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    assert.equal(f.states.length, 2);
  }
});

test('cancelled account change or close leaves an immediately usable manual-sync button', async () => {
  for (const action of ['local', 'close']) {
    let reject;
    const f = syncFixture({ unlock: () => new Promise((_resolve, fail) => { reject = fail; }) });
    const first = f.invoke(true);
    if (action === 'local') {
      const oldSync = f.context.syncService;
      oldSync.stop = async () => {};
      Object.assign(f.context, { syncTimer: null, clearInterval() {}, stopAutomatic: null, automatic: null,
        status() {}, initializeGoogle: async () => { f.context.syncService = oldSync; } });
      f.context.document.body = {};
      f.context.native.bridge.request = async method => {
        assert.equal(method, 'google.local');
        reject(Object.assign(new Error('操作已取消'), { code: 'vault-unlock-cancelled' }));
        throw new Error('帳號切換已取消');
      };
      await vm.runInContext(`${changeAccount}\nchangeGoogleAccount('local')`, f.context);
      assert.equal(f.context.accountBusy, false);
      assert.equal(f.context.document.body.inert, false);
    } else {
      f.context.nativeClosing = true;
      reject(Object.assign(new Error('操作已取消'), { code: 'vault-unlock-cancelled' }));
    }
    await first;
    assert.equal(f.nodes.get('#google-sync').disabled, false);
    f.context.nativeClosing = false;
    f.context.native.bridge.request = async method => {
      assert.equal(method, 'google.unlockVault');
      return { connected: true, accountId: 'fixture', paused: false };
    };
    await f.invoke(true);
    assert.deepEqual(f.calls.slice(-2), ['flush', ['sync', true]]);
    assert.equal(f.states.at(-1)[0], 'ok');
  }
});
