import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopDraft, DesktopClient } from '../src/desktop/client.js';
import { DesktopOwner } from '../src/desktop/owner.js';
import { download, encode, parse, CHUNK, MAX_COMMAND } from '../src/desktop/transport.js';
import { sha256 } from '../src/sources/files.js';
import { getLocale, setLocale } from '../src/i18n/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function bridge() {
  const events = new Map(); const requests = [];
  return { requests, onEvent(name, fn) { events.set(name, fn); return () => events.delete(name); },
    event(name, message) { events.get(name)?.({ event: name, ...message }); },
    async request(method, args) { requests.push({ method, args }); return {}; } };
}

for (const method of ['pointer.up', 'pointer.cancel']) test(`${method} keeps the scene preview until the changed geometry is published`, async () => {
  const transport = bridge(); const publishing = deferred(); const release = deferred();
  const received = []; const errors = []; const baseRequest = transport.request;
  transport.request = async (name, args) => {
    await baseRequest(name, args);
    if (name === 'desktop.frame.begin') return { token: 'frame-token' };
    if (name === 'desktop.frame.append') return { offset: args.offset + Buffer.from(args.base64, 'base64').length };
    if (name === 'desktop.frame.publish') { publishing.resolve(); await release.promise; }
    if (name === 'desktop.reply') received.push(args);
    return {};
  };
  const result = method === 'pointer.up' ? { kind: 'moved', cardId: 'card' } : null;
  const owner = new DesktopOwner({ bridge: transport,
    authority: { request: async () => result, whenIdle: async () => {}, close() {} },
    editor: () => null, project: sequence => ({ sequence, x: 300 }),
    changed: () => owner.publish(), error: error => errors.push(error), lost() {}, dismiss() {} });
  transport.event('desktop-command', { ticket: 'drag-ended', viewId: 'view', command: { method } });
  await publishing.promise;
  assert.deepEqual(received, []);
  release.resolve(); await owner.whenIdle(); await tick();
  assert.deepEqual(received, [{ ticket: 'drag-ended', ok: true, result }]);
  assert.deepEqual(errors, []); owner.close();
});

test('a language change publishes a fresh frame to every scene until the owner closes', async () => {
  const transport = bridge(); const baseRequest = transport.request; const frames = [];
  transport.request = async (name, args) => {
    await baseRequest(name, args);
    if (name === 'desktop.frame.begin') return { token: 'frame-token' };
    if (name === 'desktop.frame.append') {
      frames.push(JSON.parse(Buffer.from(args.base64, 'base64').toString('utf8')));
      return { offset: args.offset + Buffer.from(args.base64, 'base64').length };
    }
    return {};
  };
  const owner = new DesktopOwner({ bridge: transport, authority: { whenIdle: async () => {}, close() {} }, editor: () => null,
    project: sequence => ({ sequence, locale: getLocale() }), changed() {}, error: error => { throw error; }, lost() {}, dismiss() {} });
  try {
    setLocale('zh-TW'); await owner.whenIdle();
    assert.deepEqual(frames, [{ sequence: 1, locale: 'zh-TW' }]);
    owner.close(); setLocale('en'); await owner.whenIdle();
    assert.equal(frames.length, 1, 'a closed owner no longer follows the language');
  } finally { owner.close(); setLocale('en'); }
});

test('desktop text retries the exact uncertain version before newer input and only advances sequence on durable acknowledgement', async () => {
  const calls = []; const reply = deferred(); let fail = true;
  const client = { async command(method, args) {
    calls.push({ method, args }); if (fail) { await reply.promise; throw new Error('ack lost'); } return { sequence: args.sequence };
  } };
  const draft = new DesktopDraft(client, { cardId: 'c', draftId: 'd', sequence: 0, text: 'initial' });
  draft.text = 'first'; const saving = draft.flush(); draft.text = 'second';
  assert.equal(draft.flush(), saving); reply.resolve(); await assert.rejects(saving, /ack lost/);
  assert.equal(draft.sequence, 0); assert.equal(draft.saved, 'initial'); assert.equal(draft.text, 'second'); assert.equal(draft.dirty, true);
  fail = false; await draft.flush();
  assert.deepEqual(calls.map(c => c.args), [
    { draftId: 'd', sequence: 1, text: 'first' }, { draftId: 'd', sequence: 1, text: 'first' }, { draftId: 'd', sequence: 2, text: 'second' },
  ]);
  assert.equal(draft.saved, 'second'); assert.equal(draft.dirty, false);
});

test('view commands are admitted serially without waiting for prior execution responses', async () => {
  const transport = bridge(); const client = new DesktopClient(transport, { sessionId: crypto.randomUUID() });
  const first = client.command('editor.end', { sequence: 0 }); const draft = client.command('editor.change', { sequence: 1, text: 'last input' });
  await tick(); assert.equal(transport.requests.length, 2);
  const [one,two] = transport.requests.map(r => r.args.command);
  assert.deepEqual([one.serial, two.serial], [1,2]);
  transport.event('desktop-command-result', { commandId: two.id, ok: true, result: { sequence: 1 } });
  assert.deepEqual(await draft, { sequence: 1 });
  transport.event('desktop-command-result', { commandId: one.id, ok: true, result: null }); await first; client.close();
});

test('owner flush returns after the view confirms durable sequence and releases only its current editor', async () => {
  const transport = bridge(); const current = { viewId: 'view', draftId: 'draft', sequence: 7 };
  const owner = new DesktopOwner({ bridge: transport, authority: { whenIdle: async () => {}, close() {} },
    editor: () => current, project: () => {}, changed() {}, error: e => { throw e; }, lost() {}, dismiss() {} });
  let ended = false;
  const action = owner.perform(async () => { assert.equal(await owner.flush(current), 8); ended = true; });
  await tick(); const { id } = transport.requests.find(r => r.method === 'desktop.flush').args;
  transport.event('desktop-flushed', { id, viewId: 'other', draftId: 'draft', sequence: 8, ok: true }); await tick(); assert.equal(ended, false);
  transport.event('desktop-flushed', { id, viewId: 'view', draftId: 'draft', sequence: 8, ok: true }); await action;
  assert.deepEqual(transport.requests.at(-1), { method: 'desktop.flush.release', args: { id, viewId: 'view', draftId: 'draft' } }); owner.close();
});

test('retiring a view rejects its pending owner flush and the shared action queue remains usable', async () => {
  const transport = bridge(); const lost = [];
  const owner = new DesktopOwner({ bridge: transport, authority: { removeView: v => lost.push(v), whenIdle: async () => {}, close() {} },
    editor: () => null, project: () => {}, changed() {}, error() {}, lost() {}, dismiss() {} });
  const first = owner.perform(() => owner.flush({ viewId: 'retired', draftId: 'draft' }));
  const rejection = assert.rejects(first, e => e.code === 'desktop-view'); await tick();
  transport.event('desktop-view-lost', { viewId: 'retired', message: 'lost' }); await rejection;
  assert.deepEqual(lost, ['retired']); assert.equal(await owner.perform(() => 42), 42); owner.close();
});

test('native close retains the editor freeze until destruction, seals new commands and only releases on failed close', async () => {
  const transport = bridge(); const current = { viewId: 'view', draftId: 'draft', sequence: 2 }; const admitted = [];
  const owner = new DesktopOwner({ bridge: transport, authority: { request: async (_, command) => { admitted.push(command); }, whenIdle: async () => {}, close() {} },
    editor: () => current, project: () => {}, changed() {}, error() {}, lost() {}, dismiss() {} });
  owner.beginClose(); const close = owner.perform(() => owner.flush(current)); await tick();
  const { id } = transport.requests.find(r => r.method === 'desktop.flush').args;
  transport.event('desktop-command', { ticket: 'selection', viewId: 'view', command: { method: 'card.select' } });
  transport.event('desktop-command', { ticket: 'final-input', viewId: 'view', command: { method: 'editor.change' } }); await tick();
  transport.event('desktop-flushed', { id, viewId: 'view', draftId: 'draft', sequence: 3, ok: true }); await close;
  assert.equal(transport.requests.some(r => r.method === 'desktop.flush.release'), false);
  owner.sealClose();
  transport.event('desktop-command', { ticket: 'late-input', viewId: 'view', command: { method: 'editor.change' } }); await tick(); await owner.whenIdle();
  assert.deepEqual(admitted.map(c => c.method), ['editor.change']);
  await owner.cancelClose(); assert.equal(transport.requests.at(-1).method, 'desktop.flush.release'); owner.close();
});

test('scene chunks authenticate the complete UTF-8 payload and reject wrong offsets or digest without parsing', async () => {
  // Three-byte UTF-8 characters, so chunk boundaries fall inside characters.
  const value = { text: '中文'.repeat(200000) }; const bytes = encode(value); const descriptor = { size: bytes.length, sha256: await sha256(bytes) };
  const read = async offset => ({ offset, base64: Buffer.from(bytes.subarray(offset, offset + CHUNK)).toString('base64'), done: offset + CHUNK >= bytes.length });
  assert.deepEqual(parse(await download(descriptor, read, MAX_COMMAND)), value);
  await assert.rejects(download(descriptor, async offset => ({ ...await read(offset), offset: offset + 1 })), e => e.code === 'scene-offset');
  await assert.rejects(download({ ...descriptor, sha256: '0'.repeat(64) }, read), e => e.code === 'scene-integrity');
});
