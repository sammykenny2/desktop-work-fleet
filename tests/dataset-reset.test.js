import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetReset } from '../src/sources/dataset-reset.js';
import { DatasetLifecycle } from '../src/sources/dataset-lifecycle.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';
import { sha256 } from '../src/sources/files.js';
import { FileSync } from '../src/sources/file-sync.js';
import { MemoryAttachmentStorage, MemoryFileStore } from './fixtures/file-store.js';

async function local(records = new MemoryRecordStore()) {
  const storage = new WorkspaceRecordStorage(records, 'google:test');
  if (!await storage.load('google:test')) await Workspace.create({ profileId: 'google:test', deviceId: crypto.randomUUID(),
    area: { x: 0, y: 0, width: 1200, height: 900 }, current: true, bootstrapGroup: false, persist: (...args) => storage.save(...args) });
  return { storage, records };
}
function legacy(provider, count = 1) {
  for (let i = 0; i < count; i++) provider.files.set(`old-${String(i).padStart(6, '0')}`,
    { file: { id: `old-${String(i).padStart(6, '0')}`, kind: 'revision' }, bytes: new Uint8Array([255, 0, 128]) });
}
async function run(reset, phase = 'complete') {
  for (let i = 0; i < 1000; i++) { const status = await reset.status(); if (status.phase === phase) return status; await reset.step(); }
  throw new Error('reset did not make bounded progress');
}

test('legacy reset captures metadata before publication and only deletes exact captured leaves after readiness', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 253);
  const reset = new DatasetReset(provider, storage), preview = await reset.preview();
  await reset.begin(preview);
  const captured = await run(reset, 'fence'); assert.equal(captured.captured, 253); assert.equal(provider.stats.creates, 0);
  provider.files.set('late-legacy', { file: { id: 'late-legacy', kind: 'revision' }, bytes: new Uint8Array([255]) });
  let ready = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'ready') ready = true;
    if (point === 'delete-before') assert.equal(ready, true, 'old files survive until the new dataset is ready');
    if (point === 'read' && id.startsWith('old-')) throw new Error('legacy body must never be read');
  };
  const complete = await run(reset);
  assert.equal(complete.deleted, 253); assert.equal(complete.captured, 253); assert.ok(provider.files.has('late-legacy'));
  assert.ok(![...provider.files.keys()].some(id => id.startsWith('old-')));
  assert.deepEqual((await new DatasetLifecycle(provider, storage).inspect()).binding, complete.binding);
  const marker = JSON.parse(new TextDecoder().decode(provider.files.get(complete.marker.id).bytes));
  assert.deepEqual(Object.keys(marker).sort(), ['format', 'initialization', 'resetAt', 'schema']);
  assert.equal(marker.format, 'work-fleet-reset'); assert.equal(marker.schema, 1); assert.equal(marker.initialization, 'workspace-init-v1');
});

test('reset resumes exact capture pages, uncertain fence creation and lost deletion replies after reopen', async () => {
  const provider = new DatasetTestProvider(), first = await local(); legacy(provider, 205);
  let reset = new DatasetReset(provider, first.storage); await reset.begin(await reset.preview()); await reset.step();
  const restarted = await local(first.records); reset = new DatasetReset(provider, restarted.storage);
  await run(reset, 'fence'); const marker = (await reset.status()).marker;
  let lostFence = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && id === marker.id && !lostFence) { lostFence = true; throw Object.assign(new Error('lost reply'), { code: 'network' }); }
  };
  await reset.step(); assert.equal((await reset.status()).phase, 'initialize');
  provider.hook = async () => {}; await run(reset, 'cleanup'); await reset.step();
  let failed = false;
  provider.hook = async point => { if (point === 'delete-after' && !failed) { failed = true; throw new Error('process died'); } };
  await assert.rejects(reset.step(), /process died/);
  provider.hook = async () => {};
  reset = new DatasetReset(provider, (await local(first.records)).storage);
  const complete = await run(reset); assert.equal(complete.deleted, 205); assert.equal(complete.marker.id, marker.id);
  assert.ok(![...provider.files.keys()].some(id => id.startsWith('old-')));
});

test('a competing fence or destructive old-client reset stops cleanup without recreating the new generation', async () => {
  for (const action of ['foreign-fence', 'delete-all']) {
    const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 3);
    const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview()); await run(reset, 'cleanup');
    const before = provider.stats.creates;
    if (action === 'foreign-fence') {
      const bytes = new TextEncoder().encode('{}'); provider.files.set('foreign-fence', { file: { id: 'foreign-fence', kind: 'reset',
        size: bytes.length, sha256: await sha256(bytes) }, bytes });
    } else {
      // The old resetSource enumerates every app-data file, without format filtering.
      for (const id of [...provider.files.keys()]) await provider.deleteFile({ id });
    }
    await assert.rejects(reset.step(), { code: 'source-reset-superseded' });
    assert.equal(provider.stats.creates, before);
  }
});

test('new-format replacement removes captured content but never cascades into uncaptured descendants', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local();
  const old = await new DatasetLifecycle(provider, storage).initialize();
  const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview(), { starter: false });
  await run(reset, 'fence');
  provider.files.set('late-child', { file: { id: 'late-child', parentId: old.plan.rootId, kind: 'revision' }, bytes: new Uint8Array([255]) });
  const completed = await run(reset);
  assert.ok(completed.retainedFolders > 0); assert.ok(provider.files.has(old.plan.rootId)); assert.ok(provider.files.has('late-child'));
  assert.equal(provider.files.has(old.descriptor.id), false);
  const result = await new DatasetProtocol(provider, storage).reconcile(completed.binding.descriptor, completed.binding.plan);
  assert.equal(result.heads.length, 0, 'intentionally empty replacement stays empty');
});

test('reset rejects a stale preview and a repeated capture cursor without publishing a marker', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 203);
  const reset = new DatasetReset(provider, storage), preview = await reset.preview();
  provider.files.set('foreign', { file: { id: 'foreign', kind: 'reset' }, bytes: new Uint8Array() });
  await assert.rejects(reset.begin(preview), { code: 'source-reset-superseded' }); provider.files.delete('foreign');
  await reset.begin(await reset.preview());
  const listing = provider.listObjects.bind(provider);
  provider.listObjects = async args => { const page = await listing(args); return args.query.scope === 'legacy' ? { ...page, nextPageToken: 'loop' } : page; };
  await reset.step(); await assert.rejects(reset.step(), { code: 'invalid-reset-job' }); assert.equal(provider.stats.creates, 0);
});

test('the new reset marker stops a previously synchronized 0.4.x FileSync client', async () => {
  const oldStore = new MemoryFileStore(), workspace = await Workspace.create({ profileId: 'google:old', deviceId: 'old-device',
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist: async () => {}, bootstrapGroup: false });
  const sync = new FileSync({ workspace, storage: new MemoryAttachmentStorage(), fileStore: oldStore, bootstrapGroup: false });
  await sync.sync();
  const provider = new DatasetTestProvider(), { storage } = await local(), reset = new DatasetReset(provider, storage);
  await reset.begin(await reset.preview()); await run(reset, 'initialize');
  const { marker } = await reset.status();
  await oldStore.createFile({ file: { ...marker, id: await oldStore.allocateFileId({}) }, bytes: provider.files.get(marker.id).bytes });
  await assert.rejects(sync.sync({ force: true }), { code: 'source-reset' });
});
