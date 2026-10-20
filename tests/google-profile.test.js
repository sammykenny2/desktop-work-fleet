import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { t } from '../src/i18n/index.js';

// Run the actual account chip presenter with a bounded DOM/bridge fixture; no account data or browser is opened.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const chip = source.slice(source.indexOf('function renderAccount()'), source.indexOf('// Text and detail are host or error text'));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

function element() {
  const attributes = new Set(); const classes = new Set();
  return { attributes, classes, classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } },
    toggleAttribute(name, on) { if (on) attributes.add(name); else attributes.delete(name); }, removeAttribute(name) { delete this[name]; } };
}
function fixture({ profileId = 'google:fixture', account = { connected: true, accountId: 'fixture', email: 'synthetic@example.test' }, reply } = {}) {
  const nodes = new Map(); const requests = []; const revoked = []; let blobs = 0; let now = 1000;
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = vm.createContext({
    profileId, googleAccount: account, t, $, atob, Blob, Uint8Array, Promise,
    Date: { now: () => now },
    URL: { createObjectURL: () => `blob:photo-${++blobs}`, revokeObjectURL: url => revoked.push(url) },
    native: { bridge: { request: (method, args) => { requests.push([method, args]); return reply(args); } } },
  });
  vm.runInContext(chip, context);
  return { nodes, requests, revoked, context, later: ms => { now += ms; },
    render: () => vm.runInContext('renderAccount()', context), load: () => vm.runInContext('loadGoogleProfile()', context) };
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
  f.load(); await settle(); assert.equal(f.requests.length, 1, 'a known profile is not fetched again');
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
  f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'synthetic@example.test');
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.nodes.get('#account-avatar img').src, undefined);
  assert.equal(f.nodes.get('#account-initial').hidden, false);
});

test('a reply for an account that is no longer shown is dropped', async () => {
  const f = fixture({ reply: async () => ({ name: 'Old Account', photo: null }) });
  f.load(); f.context.googleAccount = { connected: true, accountId: 'other', email: 'other@example.test' };
  await settle(); f.render();
  assert.equal(f.nodes.get('#account-name').textContent, 'other@example.test');
  f.load(); await settle();
  assert.equal(f.nodes.get('#account-name').textContent, 'Old Account', 'the new account gets its own reply');
  assert.deepEqual(f.requests.map(([, args]) => args.accountId), ['fixture', 'other']);
});

test('a replaced photo releases its blob URL, and so does leaving the account', async () => {
  const f = fixture({ reply: async () => ({ name: 'First', photo: { type: 'image/png', data: PNG } }) });
  f.load(); await settle();
  vm.runInContext(`showGoogleProfile('fixture', { name: 'Second', photo: { type: 'image/png', data: '${PNG}' } })`, f.context);
  assert.deepEqual(f.revoked, ['blob:photo-1']);
  assert.equal(f.nodes.get('#account-avatar img').src, 'blob:photo-2');
  f.context.googleAccount = { configured: true, connected: false }; f.render();
  assert.deepEqual(f.revoked, ['blob:photo-1', 'blob:photo-2']);
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.nodes.get('#account-button').title, undefined);
});

test('local notes ask for no profile and show no tooltip', () => {
  const f = fixture({ profileId: 'local', account: { configured: true, connected: false }, reply: () => assert.fail('no request') });
  f.render(); f.load();
  assert.equal(f.nodes.get('#account-name').textContent, t('sync.account.localNotes'));
  assert.equal(f.nodes.get('#account-button').title, undefined);
  assert.equal(f.nodes.get('#account-avatar img').hidden, true);
  assert.equal(f.requests.length, 0);
});
