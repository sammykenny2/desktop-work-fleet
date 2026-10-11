import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { createSourceBackup } from '../src/backup/export.js';
import { openBackup } from '../src/backup/payload.js';
import { FileSync } from '../src/sources/file-sync.js';
import { MemoryFileStore, MemoryAttachmentStorage } from './fixtures/file-store.js';

async function client(profileId = 'google:export-fixture') {
  const storage = new MemoryAttachmentStorage();
  const workspace = await Workspace.create({ profileId, deviceId: crypto.randomUUID(),
    area: { x: 0, y: 0, width: 1400, height: 900 }, persist: async () => {} });
  return { workspace, storage };
}

test('Google export synchronizes newer remote notes and saves sync metadata in the same portable format', async () => {
  const remote = await client(); const local = await client(); const store = new MemoryFileStore();
  const remoteSync = new FileSync({ ...remote, fileStore: store });
  await remote.workspace.createCard({ format: 'markdown', text: 'other device newest' }); await remoteSync.sync();
  const sync = new FileSync({ ...local, fileStore: store });
  let prompted = false;
  const backup = await createSourceBackup({ ...local, source: { sync: () => sync.sync({ force: true }) },
    confirmKnownData: async () => { prompted = true; return true; } });
  const document = await openBackup(backup.bytes);
  assert.equal(backup.knownDataOnly, false); assert.equal(prompted, false);
  assert.equal(document.manifest.format, 'work-fleet-backup'); assert.equal(document.manifest.scope, 'known-local-data');
  assert.ok(document.manifest.lastSuccessfulSyncAt); assert.equal(document.manifest.pendingOperations, 0);
  assert.ok(document.data.records.some(record => record.value.content?.text === 'other device newest'));
  await sync.stop({ endSession: false }); await remoteSync.stop({ endSession: false });
});

test('failed Google sync requires explicit known-replica fallback and never silently saves', async () => {
  const f = await client(); await f.workspace.createCard({ format: 'markdown', text: 'known offline note' });
  const source = { sync: async () => { throw new Error('network unavailable'); } };
  await assert.rejects(createSourceBackup({ ...f, source }), { code: 'backup-export-cancelled' });
  let prompts = 0;
  const backup = await createSourceBackup({ ...f, source, confirmKnownData: async error => {
    assert.match(error.message, /network unavailable/); prompts++; return true;
  } });
  assert.equal(prompts, 1); assert.equal(backup.knownDataOnly, true);
  assert.equal(backup.manifest.lastSuccessfulSyncAt, null); assert.ok(backup.manifest.pendingOperations > 0);
  assert.ok((await openBackup(backup.bytes)).data.records.some(r => r.value.content?.text === 'known offline note'));
});

test('incomplete sync needs fallback; cancellation and profile changes cannot export', async () => {
  const f = await client(); let prompts = 0;
  const backup = await createSourceBackup({ ...f, source: { sync: async () => {} },
    confirmKnownData: async error => { assert.equal(error.code, 'backup-sync-incomplete'); prompts++; return true; } });
  assert.equal(backup.knownDataOnly, true); assert.equal(prompts, 1);
  const controller = new AbortController();
  await assert.rejects(createSourceBackup({ ...f, signal: controller.signal, source: { sync: async () => { controller.abort(); throw new Error('cancel'); } },
    confirmKnownData: async () => { throw new Error('must not prompt'); } }), { code: 'backup-cancelled' });
  const state = f.workspace.state;
  await assert.rejects(createSourceBackup({ workspace: { get state() { return state; } }, storage: f.storage,
    source: { sync: async () => { state.profileId = 'local'; state.outbox = []; } } }), { code: 'restore-profile' });
});

test('offline local export does not request Google sync or fallback', async () => {
  const f = await client('local');
  const backup = await createSourceBackup({ ...f, source: { sync: async () => { throw new Error('must not sync'); } } });
  assert.equal(backup.knownDataOnly, false); assert.equal((await openBackup(backup.bytes)).manifest.format, 'work-fleet-backup');
});

test('a failed later sync preserves the durable timestamp of the last completed sync', async () => {
  const f = await client(); const store = new MemoryFileStore(); let now = 1000;
  const sync = new FileSync({ ...f, fileStore: store, now: () => now });
  await sync.sync(); const completed = f.workspace.syncState.lastSuccessfulSyncAt;
  assert.equal(completed, new Date(now).toISOString()); now = 2000;
  store.hooks.listChanges = () => { throw new Error('incomplete pull'); };
  await assert.rejects(sync.sync({ force: true }), /incomplete pull/);
  assert.equal(f.workspace.syncState.lastSuccessfulSyncAt, completed);
  await sync.stop({ endSession: false });
});
