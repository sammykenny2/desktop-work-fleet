import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { t } from '../src/i18n/index.js';
import { GoogleProfileCache } from '../src/app/google-profile.js';

// Run the actual account chip presenter with a bounded DOM/bridge fixture; no account data or browser is opened.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const chip = source.slice(source.indexOf('function renderAccount()'), source.indexOf('// Text and detail are host or error text'));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

function element() {
  const attributes = new Set(); const classes = new Set();
  return { attributes, classes, classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } },
    toggleAttribute(name, on) { if (on) attributes.add(name); else attributes.delete(name); }, removeAttribute(name) { delete this[name]; } };
}
function fixture({ profileId = 'google:fixture', account = { connected: true, accountId: 'fixture', email: 'synthetic@example.test' },
  reply, controls = new Map(), storage } = {}) {
  const nodes = new Map(); const requests = []; const revoked = []; let blobs = 0; let now = 86401000;
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = vm.createContext({
    profileId, googleAccount: account, t, $, atob, Blob, Uint8Array, Promise, accountBusy: false, nativeClosing: false,
    storage: storage ?? { getControl: async key => structuredClone(controls.get(key) ?? null),
      putControl: async (key, value) => { controls.set(key, structuredClone(value)); } },
    GoogleProfileCache: class extends GoogleProfileCache { constructor(options) { super({ ...options, now: () => now }); } },
    Date: { now: () => now },
    URL: { createObjectURL: () => `blob:photo-${++blobs}`, revokeObjectURL: url => revoked.push(url) },
    native: { bridge: { request: (method, args) => { requests.push([method, args]); return reply(args); } } },
  });
  vm.runInContext(chip, context);
  return { nodes, requests, revoked, context, controls, later: ms => { now += ms; },
    render: () => vm.runInContext('renderAccount()', context), load: () => vm.runInContext('loadGoogleProfile()', context),
    restore: () => vm.runInContext('restoreGoogleProfile()', context) };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('the chip shows the email first, then the name and photo once a sync asks, with the email kept as its tooltip', async () => {
  const f = fixture({ reply: async () => ({ name: ' Synthetic Person ', photo: { type: 'image/png', data: PNG } }) });
  f.render();
  assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#account-button').title, 'synthetic@example.test');
  assert.equal(f.requests.length, 0, 'rendering alone does not reach Google before the first sync');
  f.load(); f.load(); await settle();
  assert.equal(JSON.stringify(f.requests), JSON.stringify([['google.profile', { accountId: 'fixture' }]]), 'a request in flight is not repeated');
  for (const [avatar, initial, label] of [['#account-avatar', '#account-initial', '#account-name'], ['#identity-avatar', '#identity-initial', '#identity-name']]) {
    assert.equal(f.nodes.get(label).textContent, 'Synthetic Person');
    assert.equal(f.nodes.get(`${avatar} img`).src, 'blob:photo-1');
    assert.equal(f.nodes.get(`${avatar} img`).hidden, false);
    assert.equal(f.nodes.get(initial).hidden, true);
    assert.equal(f.nodes.get(initial).textContent, 'S');
  }
  assert.equal(f.nodes.get('#account-button').title, 'synthetic@example.test');
  f.load(); await settle(); assert.equal(f.requests.length, 1, 'a fresh profile is not fetched again');
});

test('a failed read keeps the email and waits ten minutes; a synchronous bridge refusal does not escape', async () => {
  let fail = true;
  const f = fixture({ reply: () => {
    if (fail) throw Object.assign(new Error('busy'), { code: 'native-busy' });
    return Promise.resolve({ name: 'Synthetic Person', photo: null });
  } });
  f.render(); assert.doesNotThrow(() => f.load()); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#account-initial').hidden, false);
  f.load(); await settle(); assert.equal(f.requests.length, 1, 'the next sync does not retry at once');
  fail = false; f.later(600000); f.load(); await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.nodes.get('#account-name').textContent, 'Synthetic Person');
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.nodes.get('#account-initial').hidden, false);
});

test('an unusable reply keeps the email label and the initial', async () => {
  const f = fixture({ reply: async () => ({ name: 'x'.repeat(257), photo: { type: 'text/html', data: PNG } }) });
  f.render(); f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.nodes.get('#account-avatar img').src, undefined);
  assert.equal(f.nodes.get('#account-initial').hidden, false);
  assert.equal(f.controls.size, 0);
});

test('a reply for an account that is no longer shown is dropped', async () => {
  let finish;
  const f = fixture({ reply: args => args.accountId === 'fixture' ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ name: 'New Account', photo: null }) });
  f.load(); await settle(); f.context.googleAccount = { connected: true, accountId: 'other', email: 'other@example.test' };
  f.context.profileId = 'google:other'; f.context.storage = { getControl: async () => null, putControl: async () => {} };
  finish({ name: 'Old Account', photo: null });
  await settle(); f.render();
  assert.equal(f.nodes.get('#account-name').textContent, 'other@example.test');
  f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'New Account', 'the new account gets its own reply');
  assert.equal(f.controls.size, 0, 'the late result does not write into the previous account');
  assert.deepEqual(f.requests.map(([, args]) => args.accountId), ['fixture', 'other']);
});

test('a replaced photo releases its blob URL, and so does leaving the account', async () => {
  const f = fixture({ reply: async () => ({ name: 'First', photo: { type: 'image/png', data: PNG } }) });
  f.load(); await settle();
  vm.runInContext(`showGoogleProfile('fixture', { name: 'Same photo', photo: { type: 'image/png', data: '${PNG}' } })`, f.context);
  assert.deepEqual(f.revoked, [], 'unchanged image bytes keep the loaded blob URL');
  assert.equal(f.nodes.get('#account-avatar img').src, 'blob:photo-1');
  const replacement = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 0, 0, 0]).toString('base64');
  vm.runInContext(`showGoogleProfile('fixture', { name: 'Second', photo: { type: 'image/png', data: '${replacement}' } })`, f.context);
  assert.deepEqual(f.revoked, ['blob:photo-1']);
  assert.equal(f.nodes.get('#account-avatar img').src, 'blob:photo-2');
  f.context.googleAccount = { configured: true, connected: false }; f.render();
  assert.deepEqual(f.revoked, ['blob:photo-1', 'blob:photo-2']);
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.nodes.get('#account-button').title, undefined);
});

test('signed out, the chip offers sign-in, asks for no profile and shows no tooltip', () => {
  const f = fixture({ profileId: 'local', account: { configured: true, connected: false }, reply: () => assert.fail('no request') });
  f.render(); f.load();
  assert.equal(f.nodes.get('#account-name').textContent, t('sync.account.signInPrompt'));
  assert.equal(f.nodes.get('#account-button').title, undefined);
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.requests.length, 0);
});

const savedProfile = (overrides = {}) => ({ accountId: 'fixture', name: 'Cached Person',
  photo: { type: 'image/png', data: PNG }, updatedAt: 86400000, ...overrides });

test('a reopened renderer restores all three identity views before sync and makes no fresh-cache network request', async () => {
  const first = fixture({ reply: async () => ({ name: 'Saved Person', photo: { type: 'image/png', data: PNG } }) });
  first.load(); await settle();
  assert.deepEqual(first.controls.get('google-profile'), savedProfile({ name: 'Saved Person', updatedAt: 86401000 }));
  assert.ok(!JSON.stringify(first.controls.get('google-profile')).includes('blob:'), 'persist image bytes, never document-local URLs');
  const reopened = fixture({ controls: first.controls, reply: () => assert.fail('a fresh cache needs no Google call') });
  await reopened.restore();
  for (const [avatar, label] of [['#account-avatar', '#account-name'], ['#identity-avatar', '#identity-name'],
    ['#settings-account-avatar', '#settings-account-name']]) {
    assert.equal(reopened.nodes.get(label).textContent, 'Saved Person');
    assert.equal(reopened.nodes.get(`${avatar} img`).hidden, false);
  }
  reopened.load(); await settle();
  assert.equal(reopened.requests.length, 0);
});

test('an expired cache stays visible through a failed refresh, backs off, and retains its photo after a partial reply', async () => {
  const cached = savedProfile({ updatedAt: 0 }); let fail = true; let finish;
  const f = fixture({ controls: new Map([['google-profile', cached]]), reply: () => fail
    ? new Promise((_, reject) => { finish = reject; }) : Promise.resolve({ name: 'Updated Person', photo: null }) });
  await f.restore(); f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'Cached Person');
  assert.equal(f.nodes.get('#account-avatar img').hidden, false);
  finish(new Error('offline')); await settle();
  assert.deepEqual(f.controls.get('google-profile'), cached);
  assert.deepEqual(f.revoked, []);
  f.load(); await settle(); assert.equal(f.requests.length, 1);
  fail = false; f.later(600000); f.load(); await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.nodes.get('#account-name').textContent, 'Updated Person');
  assert.equal(f.nodes.get('#account-avatar img').hidden, false);
  assert.deepEqual(f.controls.get('google-profile').photo, cached.photo);
  assert.deepEqual(f.revoked, [], 'retaining the photo also retains its loaded blob URL');
});

test('a cached profile refreshes after one day while repeated syncs leave a fresh profile alone', async () => {
  const f = fixture({ controls: new Map([['google-profile', savedProfile()]]), reply: async () => ({ name: 'Changed Person', photo: null }) });
  await f.restore(); f.load(); f.load(); await settle();
  assert.equal(f.requests.length, 0);
  f.later(86400000); f.load(); f.load(); await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.nodes.get('#account-name').textContent, 'Changed Person');
  f.load(); await settle(); assert.equal(f.requests.length, 1);
});

test('a cached identity survives a vault pause without suggesting that synchronization is connected', async () => {
  const f = fixture({ controls: new Map([['google-profile', savedProfile()]]), reply: () => assert.fail('no fetch while paused') });
  await f.restore();
  f.context.googleAccount = { connected: false, paused: true, accountId: 'fixture', email: 'synthetic@example.test' };
  f.render(); f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'Cached Person');
  assert.equal(f.nodes.get('#account-avatar img').hidden, false);
  assert.equal(f.context.googleAccount.connected, false);
  assert.deepEqual(f.revoked, []);
  assert.equal(f.requests.length, 0);
});

test('a missing cache, another account cache and an invalid cached photo fall back safely', async () => {
  for (const saved of [null, savedProfile({ accountId: 'other' }), savedProfile({ name: '', photo: { type: 'image/png', data: 'invalid!' } }),
    savedProfile({ name: '', photo: { type: 'image/png', data: Buffer.alloc(128 * 1024 + 1).toString('base64') } })]) {
    const f = fixture({ controls: new Map([['google-profile', saved]]), reply: () => assert.fail('restore is local only') });
    await f.restore(); f.render();
    assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
    assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  }
});

test('a future cache timestamp keeps its identity visible but cannot postpone a refresh indefinitely', async () => {
  const f = fixture({ controls: new Map([['google-profile', savedProfile({ updatedAt: Number.MAX_SAFE_INTEGER })]]),
    reply: async () => ({ name: 'Current Person', photo: null }) });
  await f.restore(); assert.equal(f.nodes.get('#account-name').textContent, 'Cached Person');
  f.load(); await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.nodes.get('#account-name').textContent, 'Current Person');
});

test('optional cache read and write failures do not block the current identity or escape as sync errors', async () => {
  const f = fixture({ storage: { getControl: async () => { throw new Error('unreadable'); },
    putControl: async () => { throw new Error('disk full'); } },
    reply: async () => ({ name: 'Current Person', photo: { type: 'image/png', data: PNG } }) });
  await f.restore(); f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'Current Person');
  assert.equal(f.nodes.get('#account-avatar img').hidden, false);
  f.load(); await settle(); assert.equal(f.requests.length, 1);
});

test('signing out and back into the same account invalidates a previous session reply', async () => {
  let finish;
  const f = fixture({ reply: () => new Promise(resolve => { finish = resolve; }) });
  f.load(); await settle();
  f.context.googleAccount = { configured: true, connected: false }; f.render();
  f.context.googleAccount = { connected: true, accountId: 'fixture', email: 'synthetic@example.test' }; f.render();
  await f.restore(); finish({ name: 'Old Session', photo: { type: 'image/png', data: PNG } }); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.controls.size, 0);
});

test('a cached read finishing after account replacement never paints the previous identity', async () => {
  let finish;
  const f = fixture({ storage: { getControl: () => new Promise(resolve => { finish = resolve; }), putControl: async () => {} },
    reply: () => assert.fail('restoration does not reach Google') });
  const restoring = f.restore();
  f.context.profileId = 'google:other';
  f.context.googleAccount = { connected: true, accountId: 'other', email: 'other@example.test' }; f.render();
  finish(savedProfile()); await restoring;
  assert.equal(f.nodes.get('#account-name').textContent, 'other@example.test');
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
});

test('a status belonging to another note partition cannot read or display its cached identity', async () => {
  const f = fixture({ profileId: 'google:other', controls: new Map([['google-profile', savedProfile()]]),
    reply: () => assert.fail('the account does not match this partition') });
  await f.restore(); f.render(); f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, t('sync.account.google'));
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.requests.length, 0);
});
