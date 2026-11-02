import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetLifecycle } from '../src/sources/dataset-lifecycle.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetReset } from '../src/sources/dataset-reset.js';
import { datasetDirectories, ensureDatasetDirectory } from '../src/sources/dataset-folders.js';
import { DATASET_SHARDS, datasetFile, datasetRecord } from '../src/sources/dataset-codec.js';
import { DatasetTestProvider, DatasetTestJournal } from './fixtures/dataset/provider.js';

async function client(provider, records = new MemoryRecordStore()) {
  const storage = new WorkspaceRecordStorage(records, 'google:test'), saved = await storage.load('google:test');
  const persist = (...args) => storage.save(...args);
  const workspace = saved ? new Workspace(saved, persist, undefined, undefined, { history: storage })
    : await Workspace.create({ profileId: 'google:test', deviceId: crypto.randomUUID(), current: true, bootstrapGroup: false,
      area: { x: 0, y: 0, width: 1200, height: 900 }, persist, history: storage });
  return { records, storage, workspace, sync: new DatasetSync({ workspace, storage, fileStore: provider }) };
}
const body = text => ({ format: 'markdown', text, attachments: [] });
const cloudKinds = provider => [...provider.files.values()].map(item => item.file.kind).sort();

// Production adapters have a numeric bulk allocator. Model it too: spreading a number into an object must fail.
class BulkProvider extends DatasetTestProvider {
  allocations = [];
  async allocateFileIds(count, { signal } = {}) {
    assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 100);
    signal?.throwIfAborted(); this.allocations.push(count);
    return Promise.all(Array.from({ length: count }, () => super.allocateFileId()));
  }
}

test('an empty account creates only root, descriptor and ready; reopen and another device create nothing', async () => {
  const provider = new BulkProvider(), a = await client(provider);
  await assert.rejects(a.workspace.createCard(body('before discovery')), { code: 'initial-sync-required' });
  await a.sync.sync();
  assert.deepEqual(provider.allocations, [40]);
  assert.deepEqual(cloudKinds(provider), ['dataset', 'dataset-root', 'ready']);
  const job = await a.storage.getJob('dataset-initialize'); assert.equal(job, null);
  for (const load of [async () => a, () => client(provider, a.records), () => client(provider)]) {
    const c = await load(); await c.sync.sync({ force: true });
    assert.equal(c.workspace.snapshot.cards.length, 0); assert.equal(c.workspace.snapshot.groups.length, 0);
    assert.equal(c.workspace.pendingCount, 0);
  }
  assert.equal(provider.stats.creates, 3); assert.equal(provider.stats.deletes, 0);
});

test('two first captures share a default group and create only used branches', async () => {
  const provider = new BulkProvider(), a = await client(provider); await a.sync.sync();
  const b = await client(provider); await b.sync.sync();
  const [one, two] = await Promise.all([a.workspace.createCard(body('first device')), b.workspace.createCard(body('second device'))]);
  assert.equal(one.groupId, two.groupId);
  await Promise.all([a.sync.sync(), b.sync.sync()]); await a.sync.sync(); await b.sync.sync();
  for (const c of [a, b]) {
    assert.equal(c.workspace.snapshot.groups.length, 1); assert.equal(c.workspace.snapshot.cards.length, 2);
    assert.equal(c.workspace.snapshot.conflicts.length, 0); assert.equal(c.workspace.pendingCount, 0);
  }
  const files = [...provider.files.values()].map(item => item.file), plan = a.sync.binding.plan;
  assert.ok(!provider.files.has(plan.folders.purges));
  assert.ok(Object.values(plan.folders.buckets).every(id => !provider.files.has(id)));
  assert.ok(files.filter(file => file.kind === 'checkpoint').length === 0);
  const populated = new Set(files.filter(file => file.kind === 'change').map(file => file.shard));
  for (const shard of DATASET_SHARDS) assert.equal(provider.files.has(plan.folders.shards[shard]), populated.has(shard));
});

test('an empty reset creates three dataset objects, reports three, and finishes without a starter group', async () => {
  const provider = new BulkProvider(), c = await client(provider), reset = new DatasetReset(provider, c.storage), progress = [];
  await reset.begin(await reset.preview());
  for (let i = 0; i < 30 && (await reset.status()).phase !== 'complete'; i++) await reset.step({ progress: value => progress.push(value) });
  assert.equal((await reset.status()).phase, 'complete');
  assert.deepEqual(cloudKinds(provider), ['dataset', 'dataset-root', 'ready', 'reset']);
  assert.ok(progress.some(value => value.phase === 'initialize-progress'));
  assert.ok(progress.filter(value => value.phase === 'initialize-progress').every(value => value.total === 3));
  await c.sync.sync(); assert.equal(c.workspace.snapshot.groups.length, 0); assert.equal(c.workspace.snapshot.cards.length, 0);
  assert.equal(provider.stats.creates, 4);
});

async function oldScaffold(provider, journal) {
  provider.hook = async point => { if (point === 'create-before') throw Object.assign(new Error('offline'), { code: 'service-unavailable' }); };
  await assert.rejects(new DatasetLifecycle(provider, journal).initialize(), { code: 'service-unavailable' });
  provider.hook = async () => {};
  const job = await journal.getJob('dataset-initialize'), plan = job.binding.plan, initial = [], checkpoints = [];
  for (const shard of DATASET_SHARDS) {
    const value = datasetRecord(plan.datasetId, 'checkpoint', { operationId: crypto.randomUUID(), shard, inputs: [], heads: [] });
    const file = (await datasetFile(await provider.allocateFileId(), plan.folders.shards[shard], value)).file;
    checkpoints.push({ file, value }); initial.push(file);
  }
  const value = { ...job.objects.at(-1).value, initial };
  const ready = { file: (await datasetFile(plan.readyId, plan.rootId, value)).file, value };
  const old = { ...job, directories: datasetDirectories(plan), objects: [job.objects[0], ...checkpoints, ready], sparse: undefined };
  delete old.sparse; await journal.putJob('dataset-initialize', old); return old;
}

test('an interrupted eager initializer resumes its IDs without creating unused folders or snapshots', async () => {
  const provider = new DatasetTestProvider(), journal = new DatasetTestJournal(), old = await oldScaffold(provider, journal);
  await provider.createFolder({ file: old.directories[0] });
  const count = provider.counter, binding = await new DatasetLifecycle(provider, journal).initialize();
  assert.deepEqual(binding, old.binding); assert.equal(provider.counter, count);
  assert.deepEqual(cloudKinds(provider), ['dataset', 'dataset-root', 'ready']);
});

test('lazy folder creation verifies concurrent and uncertain results and never recreates a lost generation root', async () => {
  const provider = new DatasetTestProvider(), journal = new DatasetTestJournal();
  const { plan } = await new DatasetLifecycle(provider, journal).initialize();
  let failed = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && id === plan.folders.shards.a && !failed) {
      failed = true; throw Object.assign(new Error('reply lost'), { code: 'native-outcome-unknown' });
    }
  };
  await Promise.all([ensureDatasetDirectory(provider, plan, plan.folders.shards.a), ensureDatasetDirectory(provider, plan, plan.folders.shards.a)]);
  assert.equal(provider.stats.creates, 5);
  provider.files.get(plan.folders.shards.a).file.parentId = plan.rootId;
  await assert.rejects(ensureDatasetDirectory(provider, plan, plan.folders.shards.a), { code: 'dataset-changed' });
  provider.hook = async () => {}; await provider.deleteFile({ id: plan.rootId });
  const creates = provider.stats.creates;
  await assert.rejects(ensureDatasetDirectory(provider, plan, plan.folders.shards.b), { code: 'dataset-changed' });
  assert.equal(provider.stats.creates, creates);
});


test('shortening an older initializer never recreates a root after its descriptor was acknowledged', async () => {
  for (const phase of ['objects', 'ready-pending', 'ready']) {
    const provider = new DatasetTestProvider(), journal = new DatasetTestJournal(), old = await oldScaffold(provider, journal);
    await journal.putJob('dataset-initialize', { ...old, phase });
    const creates = provider.stats.creates;
    await assert.rejects(new DatasetLifecycle(provider, journal).initialize());
    assert.equal(provider.stats.creates, creates);
  }
});
