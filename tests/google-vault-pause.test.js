import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the actual account presenter with a bounded DOM/bridge fixture; no account data or browser is opened.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const initialize = source.slice(source.indexOf('async function initializeGoogle()'), source.indexOf('function renderGoogleAccess()'));
const presenter = source.slice(source.indexOf('function renderGoogleAccess()'), source.indexOf('// The account chip'));

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
