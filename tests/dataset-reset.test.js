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
import { GoogleDriveFileStore } from '../src/sources/google-drive.js';
import { NativeGoogleDatasetStore } from '../src/native/google.js';
import { driveBatchResponse } from './fixtures/dataset/drive-batch.js';

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

test('legacy reset captures metadata before publication and clears exact captured leaves before creating a new dataset', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 253);
  const reset = new DatasetReset(provider, storage), preview = await reset.preview();
  await reset.begin(preview);
  const captured = await run(reset, 'fence'); assert.equal(captured.captured, 253); assert.equal(provider.stats.creates, 0);
  provider.files.set('late-legacy', { file: { id: 'late-legacy', kind: 'revision' }, bytes: new Uint8Array([255]) });
  let ready = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'ready') ready = true;
    if (point === 'delete-before') assert.equal(ready, false, 'confirmed old content is deleted without requiring a new dataset');
    if (point === 'read' && id.startsWith('old-')) throw new Error('legacy body must never be read');
  };
  const complete = await run(reset);
  assert.equal(complete.residualLegacy, true); assert.equal(complete.deleted, 253); assert.equal(complete.captured, 253); assert.ok(provider.files.has('late-legacy'));
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
  await reset.step(); assert.equal((await reset.status()).phase, 'clearing');
  provider.hook = async () => {}; await run(reset, 'clearing');
  let failed = false;
  provider.hook = async point => { if (point === 'delete-after' && !failed) { failed = true; throw new Error('process died'); } };
  await assert.rejects(reset.step(), /process died/);
  provider.hook = async () => {};
  reset = new DatasetReset(provider, (await local(first.records)).storage);
  const complete = await run(reset); assert.equal(complete.deleted, 205); assert.equal(complete.marker.id, marker.id);
  assert.ok(![...provider.files.keys()].some(id => id.startsWith('old-')));
});

test('106 legacy files are acknowledged in two batches before separately reported initialization', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 106);
  const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview());
  await run(reset, 'clearing');
  const progress = [];
  await reset.step({ progress: value => progress.push(value) });
  await reset.step({ progress: value => progress.push(value) });
  assert.equal(provider.stats.deleteBatches, 2);
  assert.equal((await reset.status()).deleted, 106);
  assert.equal(provider.stats.creates, 1, 'only the fence exists while old content is cleared');
  assert.ok(progress.some(value => value.phase === 'clearing' && value.completed > 0 && !value.ready));
  await run(reset, 'initialize');
  const initialized = [];
  await reset.step({ progress: value => initialized.push(value) });
  const counts = initialized.filter(value => value.phase === 'initialize-progress');
  assert.ok(counts.length > 1 && counts[0].completed === 0 && counts.at(-1).completed > 0);
  assert.ok(counts.every(value => value.total !== 106));
  assert.equal(initialized.at(-1).phase, 'activate');
  assert.equal((await run(reset)).phase, 'complete');
});

test('106-file reset resumes after an unrecognized deletion reply through both production batch adapters', async () => {
  for (const native of [false, true]) {
    const provider = new DatasetTestProvider(), first = await local(); legacy(provider, 106);
    const batches = [], replies = []; let transfer;
    const send = async ids => {
      batches.push([...ids]);
      const statuses = [];
      for (const [index, id] of ids.entries()) {
        statuses.push([index, provider.files.has(id) ? 204 : 404]);
        await provider.deleteFile({ id });
      }
      replies.push(statuses.map(([, status]) => status));
      const body = driveBatchResponse(statuses);
      // The remote action finished, but no result may be acknowledged from an incomplete reply.
      return batches.length === 1 ? body.slice(0, -16) : body;
    };
    const transport = native ? new NativeGoogleDatasetStore({ request: async (method, args) => {
      if (method === 'google.deleteBatch') {
        assert.equal(args.accountId, 'test'); transfer = await send(args.fileIds);
        return { token: 'reply', size: transfer.length, sha256: await sha256(transfer) };
      }
      assert.equal(args.token, 'reply');
      if (method === 'transfer.read') return { offset: 0, done: true, base64: Buffer.from(transfer).toString('base64') };
      assert.equal(method, 'transfer.discard'); transfer = null; return {};
    } }, { profileId: 'google:test' }, 'test') : new GoogleDriveFileStore({ accountId: 'test', request: async input => {
      assert.equal(input.path, '/batch/drive/v3'); assert.equal(input.method, 'POST');
      const ids = [...new TextDecoder().decode(input.body).matchAll(/DELETE \/drive\/v3\/files\/([A-Za-z0-9_-]+) HTTP\/1\.1/g)].map(match => match[1]);
      return { status: 200, headers: {}, body: await send(ids) };
    } });
    provider.deleteFiles = args => transport.deleteFiles(args);
    provider.hook = async (point, id) => {
      if (point === 'read' && id.startsWith('old-')) throw new Error('Legacy contents must not be read');
    };
    const reset = new DatasetReset(provider, first.storage);
    await reset.begin(await reset.preview()); await run(reset, 'clearing');
    const before = await reset.status();
    provider.files.set('late-legacy', { file: { id: 'late-legacy', kind: 'revision' }, bytes: new Uint8Array([255]) });
    await assert.rejects(reset.step(), { code: 'invalid-source-response' });
    assert.equal((await reset.status()).deleted, 0);
    assert.equal(provider.stats.deletes, batches[0].length);
    const reopened = new DatasetReset(provider, (await local(first.records)).storage);
    const complete = await run(reopened);
    assert.equal(complete.operationId, before.operationId); assert.equal(complete.marker.id, before.marker.id);
    assert.equal(complete.deleted, 106); assert.equal(complete.residualLegacy, true);
    assert.ok(provider.files.has('late-legacy'));
    assert.equal(batches.length, 3); assert.deepEqual(batches[0], batches[1]);
    assert.deepEqual([batches[0].length, batches[2].length].sort((a, b) => a - b), [6, 100]);
    assert.ok(replies[0].every(status => status === 204)); assert.ok(replies[1].every(status => status === 404));
    assert.ok(replies[2].every(status => status === 204));
  }
});

test('an unfinished earlier reset clears unreadable dataset descriptors before retrying initialization', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 106);
  provider.files.set('broken-dataset', { file: { id: 'broken-dataset', kind: 'dataset' }, bytes: new Uint8Array([255]) });
  const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview()); await run(reset, 'clearing');
  const before = await reset.status();
  await storage.putJob('dataset-reset', { ...before, phase: 'initialize' }); // The phase persisted by 0.5.0–0.5.3.
  let fail = true;
  provider.hook = async (point, id) => {
    if (point === 'read' && (id.startsWith('old-') || id === 'broken-dataset')) throw new Error('Old contents must not be decoded');
    if (point === 'create-before' && fail) { fail = false; throw Object.assign(new Error('New initialization failed'), { code: 'invalid-dataset' }); }
  };
  await reset.step(); assert.equal((await reset.status()).phase, 'clearing');
  await run(reset, 'initialize');
  assert.equal((await reset.status()).deleted, 107); assert.equal(provider.files.has('broken-dataset'), false);
  await assert.rejects(reset.step(), { code: 'invalid-dataset' });
  const deletions = provider.stats.deletes;
  const complete = await run(new DatasetReset(provider, storage));
  assert.equal(complete.operationId, before.operationId); assert.equal(complete.deleted, 107);
  assert.equal(provider.stats.deletes, deletions, 'retrying initialization does not repeat acknowledged cleanup');
});

test('partial batch failures persist successful IDs and retry only the remainder after reopen', async () => {
  const provider = new DatasetTestProvider(), first = await local(); legacy(provider, 100);
  const reset = new DatasetReset(provider, first.storage); await reset.begin(await reset.preview()); await run(reset, 'clearing');
  const batches = [], send = provider.deleteFiles.bind(provider); let fail = true;
  provider.deleteFiles = args => { batches.push([...args.ids]); return send(args); };
  provider.hook = async (point, id) => {
    if (point === 'delete-before' && id === 'old-000031' && fail) { fail = false; throw Object.assign(new Error('Limited'), { code: 'rate-limit' }); }
  };
  await assert.rejects(reset.step(), { code: 'rate-limit' }); assert.equal((await reset.status()).deleted, 99);
  const reopened = new DatasetReset(provider, (await local(first.records)).storage);
  await reopened.step(); assert.deepEqual(batches.map(ids => ids.length), [100, 1]);
  assert.deepEqual(batches[1], ['old-000031']); assert.equal((await run(reopened)).deleted, 100);
});

test('empty initialization reserves exactly its bounded IDs in one allocation call', async () => {
  for (const starter of [true, false]) {
    const provider = new DatasetTestProvider(), { storage } = await local(); let calls = 0, count = 0;
    const allocate = provider.allocateFileId.bind(provider);
    provider.allocateFileIds = async requested => { calls++; count = requested; return Promise.all(Array.from({ length: requested }, allocate)); };
    provider.allocateFileId = () => { throw new Error('Individual allocation defeats the bootstrap batch'); };
    await new DatasetLifecycle(provider, storage).initialize({ starter });
    assert.equal(calls, 1); assert.equal(provider.files.size, count);
  }
});

test('expired capture and audit tokens restart only their own enumeration after reopen', async () => {
  const provider = new DatasetTestProvider(), first = await local(); legacy(provider, 205);
  let reset = new DatasetReset(provider, first.storage); await reset.begin(await reset.preview()); await reset.step();
  const listing = provider.listObjects.bind(provider); let expire = true;
  provider.listObjects = async args => {
    if (expire && args.query.scope === 'legacy' && args.pageToken) { expire = false; throw Object.assign(new Error('expired'), { code: 'page-expired' }); }
    return listing(args);
  };
  reset = new DatasetReset(provider, (await local(first.records)).storage);
  await reset.step(); assert.equal((await reset.status()).phase, 'capture-restart');
  assert.equal(provider.stats.creates, 0);
  const captured = await run(reset, 'fence'); assert.equal(captured.captured, 205);
  await run(reset, 'residual-audit');
  legacy(provider, 220); // Late old-client writes may be reported, but never join the deletion journal.
  const deleted = provider.stats.deletes; await reset.step(); expire = true;
  await reset.step(); assert.equal((await reset.status()).phase, 'audit-restart');
  const completed = await run(new DatasetReset(provider, (await local(first.records)).storage));
  assert.equal(completed.residualLegacy, true); assert.equal(completed.deleted, 205);
  assert.equal(provider.stats.deletes, deleted); assert.ok(provider.files.has('old-000219'));
});

test('reset tolerates delayed listing of its verified fence without accepting a foreign fence', async () => {
  const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider);
  const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview()); await run(reset, 'initialize');
  const marker = (await reset.status()).marker.id, listing = provider.listObjects.bind(provider); let hidden = 2;
  provider.listObjects = async args => {
    const page = await listing(args);
    return args.query.scope === 'fences' && hidden-- > 0 ? { ...page, files: page.files.filter(file => file.id !== marker) } : page;
  };
  assert.equal((await run(reset)).phase, 'complete');
});

test('a competing fence or destructive old-client reset stops cleanup without recreating the new generation', async () => {
  for (const action of ['foreign-fence', 'delete-all']) {
    const provider = new DatasetTestProvider(), { storage } = await local(); legacy(provider, 3);
    const reset = new DatasetReset(provider, storage); await reset.begin(await reset.preview()); await run(reset, 'clearing');
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
