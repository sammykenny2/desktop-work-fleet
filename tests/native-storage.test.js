import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, access, readFile, readdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { NativeBridge } from '../src/native/bridge.js';
import { NativeStorage } from '../src/storage/native.js';
import { sha256 } from '../src/sources/files.js';
import { Workspace } from '../src/core/workspace.js';
import { nativeBackupAdapters } from '../src/backup/native.js';
import { AutomaticBackup } from '../src/backup/automatic.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { prepareLocalRestore } from '../src/backup/restore.js';

const configuration = process.env.WORK_FLEET_NATIVE_TEST_CONFIGURATION || 'Debug';
assert.ok(['Debug', 'Release'].includes(configuration), 'native test configuration must be Debug or Release');
const executable = path.resolve(`tests/native/windows/core/bin/${configuration}/net8.0-windows/WorkFleet.Windows.Core.Tests.dll`);
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
  let bridge = new NativeBridge(transport, { timeout: Math.max(timeout, 10_000) });
  let info;
  try { info = await bridge.request('host.info'); }
  catch (error) { bridge.close(); process.stdin.end(); await exit; throw error; }
  // The deliberately short reply-loss timeout applies to requests after startup,
  // not to launching a cold .NET process on a busy build machine.
  if (timeout < 10_000) { bridge.close(); bridge = new NativeBridge(transport, { timeout }); }
  return { directory, info, bridge, storage: new NativeStorage(bridge, info),
    dropNextReply: () => { drop = () => true; },
    dropCommitReply: (method = 'storage.commit') => {
      const original = transport.postMessage;
      transport.postMessage = request => {
        if (request.method === method) { drop = reply => reply.id === request.id; transport.postMessage = original; }
        original(request);
      };
    },
    async close() { bridge.close(); process.stdin.end(); const ended = await exit; assert.equal(ended.code, 0, failure || JSON.stringify(ended)); },
  };
}

nativeTest('native reset deletes the profile workspace, journal and attachments, and a fresh workspace saves again', async () => {
  const host = await session(); const area = { x: 0, y: 0, width: 1000, height: 800 };
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'reset-native', area, persist: (state, revision) => host.storage.save(state, revision) });
    const payload = new TextEncoder().encode('reset attachment 中文'); const digest = await sha256(payload);
    await host.storage.putAttachmentBytes('local', digest, payload);
    await workspace.createCard({ format: 'markdown', text: '重設前的便箋', attachments: [{ id: digest, size: payload.length, name: 'a.txt' }] });
    await host.storage.saveJournal({ profileId: 'local', revision: 0 }, null);
    await assert.rejects(host.storage.reset('other'), { code: 'invalid-profile' });
    await host.storage.reset('local');
    assert.equal(await host.storage.load('local'), null); assert.equal(await host.storage.journal().load('local'), null);
    assert.equal(await host.storage.getAttachment('local', digest), null);
    const fresh = await Workspace.create({ profileId: 'local', deviceId: 'reset-native-2', area, persist: (state, revision) => host.storage.save(state, revision) });
    assert.equal((await host.storage.load('local')).revision, fresh.state.revision);
  } finally { await host.close(); }
});

nativeTest('full local restore survives a lost commit reply with new graph, drafts and exact attachment replacement', async () => {
  const host = await session(undefined, 300); const area = { x: 0, y: 0, width: 1000, height: 800 };
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'replace-target', area,
      persist: (state, revision) => host.storage.save(state, revision) });
    const old = await workspace.createCard({ format: 'markdown', text: 'old local note' });
    const oldBytes = new TextEncoder().encode('old blob'); const oldId = await sha256(oldBytes);
    await host.storage.putAttachmentBytes('local', oldId, oldBytes);
    const source = await Workspace.create({ profileId: 'google:fixture', deviceId: 'replace-source', area, persist: async () => {} });
    const fresh = new TextEncoder().encode('new blob'); const freshId = await sha256(fresh);
    await source.createCard({ format: 'markdown', text: 'restored cloud note', attachments: [{ id: freshId, size: fresh.length, name: 'new.txt' }] });
    const draft = source.blankDraft(source.snapshot.groups[0].id); draft.content.text = 'offline draft'; await source.saveDraft(draft);
    const document = await openBackup((await createBackup({ workspace: source, storage: { getAttachment: async () => new Blob([fresh]) } })).bytes);
    const plan = await prepareLocalRestore({ workspace, document, layout: 'backup', workAreas: [area] });
    host.dropCommitReply();
    const receipt = await workspace.applyRestore(plan, { persist: (...args) => host.storage.saveWithAttachments(...args) });
    assert.equal(receipt.mode, 'local-replace'); assert.equal(workspace.revisionHeads('card', old.id).length, 0);
    assert.deepEqual(workspace.state.revisions, document.data.records); assert.deepEqual(workspace.state.drafts, source.state.drafts);
    assert.deepEqual(await host.storage.load('local'), workspace.state);
    assert.equal(await host.storage.getAttachment('local', oldId), null);
    assert.deepEqual(new Uint8Array(await (await host.storage.getAttachment('local', freshId)).arrayBuffer()), fresh);
    assert.deepEqual(await workspace.applyRestore(plan, { persist: (...args) => host.storage.saveWithAttachments(...args) }), receipt);
  } finally { await host.close(); }
});

nativeTest('native automatic encryption, retention and directory/key grants survive restart; portable restore reads every saved byte', async () => {
  let host = await session(); const directory = host.directory; const password = '原生加密備份-十二個字元-🦋';
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'backup-native', area: { x: 0, y: 0, width: 1000, height: 800 },
      persist: (state, revision) => host.storage.save(state, revision) });
    const payload = new TextEncoder().encode('backup attachment 中文'); const digest = await sha256(payload);
    await host.storage.putAttachmentBytes('local', digest, payload);
    const card = await workspace.createCard({ format: 'markdown', text: '# Native backup\n- [ ] retain', attachments: [{ id: digest, size: payload.length, name: '中文.txt' }] });
    const draft = workspace.blankDraft(card.groupId, card); draft.content.text += '\nunsaved editor'; await workspace.saveDraft(draft);
    let adapters = nativeBackupAdapters(host.bridge, host.info);
    const location = await adapters.files.chooseDestination(); const keyId = await adapters.vault.create({ password });
    assert.equal(JSON.stringify(location).includes(directory), false); assert.match(keyId, /^[a-f0-9-]{36}$/);
    let service = new AutomaticBackup({ workspace, storage: host.storage, journal: host.storage.journal(), ...adapters });
    await service.configure({ ...location, encrypted: true, keyId, keep: 2 });
    for (let i = 0; i < 3; i++) assert.equal((await service.run({ force: true })).kind, 'saved');
    const state = service.state; assert.equal(state.inventory.length, 2);
    assert.equal((await readdir(path.join(directory, 'backups'))).length, 2);
    const latest = new Uint8Array(await readFile(path.join(directory, 'backups', state.lastSuccess.name)));
    await assert.rejects(openBackup(latest), { code: 'backup-password' });
    await assert.rejects(openBackup(latest, { password: 'another wrong secret' }), { code: 'backup-decryption' });
    const document = await openBackup(latest, { password });
    assert.deepEqual(document.data.records, workspace.state.revisions); assert.deepEqual(document.attachment(digest), payload);
    assert.equal(document.data.drafts[0].content.text, draft.content.text);
    assert.equal(JSON.stringify(await host.storage.journal().load('local')).includes(password), false);
    await host.close(); host = await session(directory); adapters = nativeBackupAdapters(host.bridge, host.info);
    service = new AutomaticBackup({ workspace: new Workspace(await host.storage.load('local')), storage: host.storage, journal: host.storage.journal(), ...adapters });
    await service.load(); assert.equal((await service.run({ force: true })).kind, 'saved');
    assert.equal((await readdir(path.join(directory, 'backups'))).length, 2);
    const request = { ...service.state.lastSuccess, profileId: 'local' };
    await assert.rejects(host.bridge.request('backup.read', { ...request, profileId: 'other' }), { code: 'backup-profile' });
    await assert.rejects(adapters.files.remove(request), { code: 'backup-retention' });
    await assert.rejects(host.bridge.request('vault.read', { id: keyId }), { code: 'unsupported-method' });
  } finally { await host.close(); }
});

nativeTest('native file acknowledgement loss recovers one original job; changed owned files survive retention', async () => {
  let host = await session(undefined, 500); const directory = host.directory;
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'backup-loss', area: { x: 0, y: 0, width: 1000, height: 800 },
      persist: (state, revision) => host.storage.save(state, revision) });
    await workspace.createCard({ format: 'markdown', text: 'saved through loss', attachments: [] });
    let adapters = nativeBackupAdapters(host.bridge, host.info);
    let service = new AutomaticBackup({ workspace, storage: host.storage, journal: host.storage.journal(), ...adapters });
    await service.configure({ ...await adapters.files.chooseDestination(), encrypted: false, keep: 1 });
    host.dropCommitReply('backup.create');
    await assert.rejects(service.run(), { code: 'native-outcome-unknown' });
    const job = service.state.pending; assert.ok(job); assert.equal((await readdir(path.join(directory, 'backups'))).length, 1);
    await host.close(); host = await session(directory); adapters = nativeBackupAdapters(host.bridge, host.info);
    service = new AutomaticBackup({ workspace, storage: host.storage, journal: host.storage.journal(), ...adapters });
    assert.equal((await service.run({ force: true })).kind, 'recovered'); assert.equal(service.state.lastSuccess.id, job.id);
    assert.equal((await readdir(path.join(directory, 'backups'))).length, 1);
    await appendFile(path.join(directory, 'backups', job.name), 'user-changed');
    await assert.rejects(service.run({ force: true }), { code: 'backup-file-changed' });
    assert.equal((await readdir(path.join(directory, 'backups'))).length, 2);
    assert.ok((await readFile(path.join(directory, 'backups', job.name), 'utf8')).endsWith('user-changed'));
  } finally { await host.close(); }
});

nativeTest('native manual save returns proof, consumes picker once and cancels before creating a file; missing key never falls back', async () => {
  const host = await session();
  try {
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'manual', area: { x: 0, y: 0, width: 1000, height: 800 },
      persist: (state, revision) => host.storage.save(state, revision) });
    const adapters = nativeBackupAdapters(host.bridge, host.info); const backup = await createBackup({ workspace, storage: host.storage });
    const destination = await adapters.manual.chooseDestination(); const phases = [];
    assert.equal((await destination.save({ bytes: backup.bytes, progress: value => phases.push(value.phase) })).saved, true);
    assert.deepEqual(phases, ['save-commit']);
    await assert.rejects(destination.save({ bytes: backup.bytes }), { code: 'backup-permission' });
    assert.equal((await readdir(path.join(host.directory, 'backups'))).length, 1);
    const cancelled = await adapters.manual.chooseDestination(); const controller = new AbortController(); controller.abort();
    await assert.rejects(cancelled.save({ bytes: backup.bytes, signal: controller.signal }), { code: 'backup-cancelled' });
    await assert.rejects(adapters.vault.encrypt({ profileId: 'local', keyId: crypto.randomUUID(), bytes: backup.bytes }), { code: 'backup-key-unavailable' });
    await assert.rejects(adapters.vault.create({ password: 'short' }), { code: 'backup-password' });
    await assert.rejects(adapters.vault.create({ password: 'abcdefghijkl\ud800' }), { code: 'invalid-request' });
    assert.equal((await readdir(path.join(host.directory, 'backups'))).length, 1);
  } finally { await host.close(); }
});

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
