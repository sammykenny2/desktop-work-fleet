import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { NativeBridge } from '../src/native/bridge.js';
import { NativeStorage } from '../src/storage/native.js';
import { sha256 } from '../src/sources/files.js';
import { Workspace } from '../src/core/workspace.js';

const executable = path.resolve('tests/native/windows-core/bin/Debug/net8.0-windows/WorkFleet.Windows.Core.Tests.dll');
const enabled = process.env.WORK_FLEET_NATIVE_TEST === '1';
if (enabled) await access(executable); // An explicitly requested but missing native build must fail.
const nativeTest = (name, action) => test(name, { skip: !enabled, timeout: 60_000 }, action);

async function session(directory = path.resolve(`build/native-js-${crypto.randomUUID()}`), timeout = 10_000) {
  await mkdir(directory, { recursive: true });
  const process = spawn('dotnet', [executable, '--bridge', directory], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = new EventEmitter(); let failure = ''; let drop;
  process.stderr.on('data', bytes => { failure += bytes; });
  const exit = new Promise(resolve => process.on('exit', (code, signal) => resolve({ code, signal })));
  const lines = createInterface({ input: process.stdout });
  lines.on('line', line => { const reply = JSON.parse(line); if (drop?.(reply)) { drop = null; return; } events.emit('message', { data: reply }); });
  const transport = { addEventListener: (name, listener) => events.on(name, listener), removeEventListener: (name, listener) => events.off(name, listener),
    postMessage: value => process.stdin.write(JSON.stringify(value) + '\n') };
  const bridge = new NativeBridge(transport, { timeout });
  const info = await bridge.request('host.info');
  return { directory, info, bridge, storage: new NativeStorage(bridge, info),
    dropNextReply: () => { drop = () => true; },
    dropCommitReply: () => {
      const original = transport.postMessage;
      transport.postMessage = request => {
        if (request.method === 'storage.commit') { drop = reply => reply.id === request.id; transport.postMessage = original; }
        original(request);
      };
    },
    async close() { bridge.close(); process.stdin.end(); const ended = await exit; assert.equal(ended.code, 0, failure || JSON.stringify(ended)); },
  };
}

nativeTest('real native protocol preserves Workspace drafts/history and attachments across process restart', async () => {
  let host = await session(); const directory = host.directory;
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'native-test', area: { x: 0, y: 0, width: 1000, height: 800 },
      persist: (state, revision) => host.storage.save(state, revision) });
    const bytes = new Uint8Array(900_000).map((_, index) => index % 251); const id = await sha256(bytes);
    await host.storage.putAttachmentBytes('local', id, bytes);
    const card = await workspace.createCard({ format: 'markdown', text: 'original native card', attachments: [{ id, size: bytes.length, name: 'chunked.bin' }] });
    await workspace.updateCard(card.id, { completed: true }, card.revision);
    const draft = workspace.blankDraft(card.groupId, workspace.snapshot.cards[0]); draft.content.text = 'draft to retain'; await workspace.saveDraft(draft);
    const previous = workspace.state.revision; const state = workspace.state; state.revision++;
    state.nativeFixture = { text: '中文 🐋', attachment: id, large: 'chunked-transfer\n'.repeat(60000) };
    await host.storage.save(state, previous);
    assert.deepEqual(await host.storage.load('local'), state);
    await host.close(); host = await session(directory);
    assert.deepEqual(await host.storage.load('local'), state);
    assert.deepEqual(new Uint8Array(await (await host.storage.getAttachment('local', id)).arrayBuffer()), bytes);
    assert.equal(new Workspace(await host.storage.load('local')).state.profileId, 'local');
    await assert.rejects(host.storage.load('another-profile'), { code: 'invalid-profile' });
  } finally { await host.close(); }
});

nativeTest('real native CAS rollback leaves newly staged restore attachments invisible', async () => {
  const host = await session();
  try {
    await host.storage.save({ profileId: 'local', revision: 0 }, null);
    const bytes = new TextEncoder().encode('atomic restore attachment'); const id = await sha256(bytes);
    await assert.rejects(host.storage.saveWithAttachments({ profileId: 'local', revision: 1 }, null, [{ id, bytes }]), { code: 'stale-writer' });
    assert.equal(await host.storage.getAttachment('local', id), null);
    assert.deepEqual(await host.storage.load('local'), { profileId: 'local', revision: 0 });
    await host.storage.saveWithAttachments({ profileId: 'local', revision: 1, restoreReceipts: [{ id: 'synthetic-receipt' }] }, 0, [{ id, bytes }]);
    assert.equal((await host.storage.load('local')).restoreReceipts.length, 1);
    assert.equal((await host.storage.getAttachment('local', id)).size, bytes.length);
  } finally { await host.close(); }
});

nativeTest('lost native commit acknowledgement resolves only after exact durable readback', async () => {
  const host = await session(undefined, 300);
  try {
    host.dropCommitReply(); await host.storage.save({ profileId: 'local', revision: 0, text: 'committed despite lost reply' }, null);
    assert.equal((await host.storage.load('local')).text, 'committed despite lost reply');
    await assert.rejects(host.storage.save({ profileId: 'local', revision: 1 }, null), { code: 'stale-writer' });
  } finally { await host.close(); }
});

nativeTest('native journal is isolated and attachment hash rejection changes no visible data', async () => {
  const host = await session();
  try {
    const journal = host.storage.journal(); await journal.save({ profileId: 'local', revision: 0, enabled: false }, null);
    assert.equal(await host.storage.load('local'), null);
    assert.equal((await journal.load('local')).enabled, false);
    await assert.rejects(journal.save({ profileId: 'local', revision: 1 }, null), { code: 'stale-backup-writer' });
    await assert.rejects(host.storage.putAttachmentBytes('local', '0'.repeat(64), new Uint8Array([1, 2])), { code: 'attachment-integrity' });
    await assert.rejects(host.bridge.request('vault.read', { id: 'never-available' }), { code: 'unsupported-method' });
  } finally { await host.close(); }
});

nativeTest('unfinished, reordered and damaged native transfers cannot commit', async () => {
  const host = await session();
  try {
    const token = (await host.bridge.request('transfer.begin', { kind: 'attachment', size: 2, sha256: '0'.repeat(64) })).token;
    await assert.rejects(host.bridge.request('transfer.finish', { token }), { code: 'transfer-incomplete' });
    await assert.rejects(host.bridge.request('transfer.append', { token, offset: 1, base64: 'AQI=' }), { code: 'transfer-offset' });
    await host.bridge.request('transfer.append', { token, offset: 0, base64: 'AQI=' });
    await assert.rejects(host.bridge.request('transfer.finish', { token }), { code: 'transfer-integrity' });
    await host.bridge.request('transfer.discard', { token });
    await assert.rejects(host.bridge.request('storage.putAttachment', { token }), { code: 'transfer-missing' });
  } finally { await host.close(); }
});

test('native bridge ignores unrelated replies and rejects pending work on disconnect', async () => {
  const events = new EventEmitter(); let sent;
  const bridge = new NativeBridge({ addEventListener: (name, fn) => events.on(name, fn), removeEventListener: (name, fn) => events.off(name, fn), postMessage: request => { sent = request; } });
  const pending = bridge.request('host.info');
  events.emit('message', { data: { v: 1, id: 'not-the-request', ok: true, result: 'untrusted' } });
  bridge.close(); await assert.rejects(pending, { code: 'native-outcome-unknown' });
  assert.ok(sent.id); await assert.rejects(bridge.request('host.info'), { code: 'native-closed' });
});

test('native bridge accepts the largest token manifest and rejects oversized requests before transport', async () => {
  const events = new EventEmitter(); let writes = 0;
  const bridge = new NativeBridge({ addEventListener: (name, fn) => events.on(name, fn), removeEventListener: (name, fn) => events.off(name, fn),
    postMessage: request => { writes++; events.emit('message', { data: { v: 1, id: request.id, ok: true, result: null } }); } });
  try {
    await bridge.request('storage.commit', { kind: 'workspace', token: crypto.randomUUID(), expectedRevision: 0,
      attachments: Array.from({ length: 20000 }, () => crypto.randomUUID()) });
    assert.equal(writes, 1);
    await assert.rejects(bridge.request('test', { text: '文'.repeat(400000) }), { code: 'message-size' });
    assert.equal(writes, 1);
  } finally { bridge.close(); }
});
