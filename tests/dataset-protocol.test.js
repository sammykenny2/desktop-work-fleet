import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASET_SHARDS, datasetRecord, datasetFile, datasetShard, datasetQuery, datasetMetadata, googleDatasetDescriptor,
  decodeDatasetRecord, validateDatasetFile } from '../src/sources/dataset-codec.js';
import { DatasetProtocol, mergeDatasetInputs } from '../src/sources/dataset-protocol.js';
import { revisionRecord } from '../src/sources/revisions.js';
import { DatasetTestProvider, DatasetTestJournal } from './fixtures/dataset/provider.js';

const note = (id, revision, parents = [], text = revision) => revisionRecord('card', { id, revision, groupId: 'group',
  content: { format: 'markdown', text }, deleted: false, archived: false, completed: false }, parents);
async function fixture() {
  const store = new DatasetTestProvider(), protocol = new DatasetProtocol(store, store), id = crypto.randomUUID();
  async function folder(role, parentId = 'appDataFolder', entityId) {
    const file = { id: await store.allocateFileId(), datasetId: id, kind: role === 'root' ? 'dataset-root' : 'folder', role, parentId,
      ...(entityId ? { entityId } : {}) }; await store.createFolder({ file }); return file.id;
  }
  const rootId = await folder('root'), readyId = await store.allocateFileId();
  const folders = { notes: await folder('notes', rootId), groups: await folder('groups', rootId), current: await folder('current', rootId),
    purges: await folder('purges', rootId), shards: {}, buckets: {} };
  for (const shard of DATASET_SHARDS) {
    folders.shards[shard] = await folder(`current-${shard}`, folders.current);
    if (shard !== 'groups') folders.buckets[shard] = await folder(`purges-${shard}`, folders.purges);
  }
  const plan = datasetRecord(id, 'dataset', { rootId, readyId, fenceId: null, folders });
  const descriptor = await protocol.publish('descriptor', rootId, plan);
  const initial = [];
  for (const shard of DATASET_SHARDS) initial.push(await protocol.publish(`initial:${shard}`, folders.shards[shard],
    datasetRecord(id, 'checkpoint', { operationId: crypto.randomUUID(), shard, inputs: [], heads: [] })));
  const ready = await datasetFile(readyId, rootId, datasetRecord(id, 'ready', { descriptor: { id: descriptor.id, sha256: descriptor.sha256 }, initial }));
  await store.createObject(ready);
  async function change(record) {
    const existing = [...store.files.values()].find(item => item.file.kind === 'folder' && item.file.entityId === record.entityId);
    const parentId = existing?.file.id ?? await folder('note', folders.notes, record.entityId);
    const value = datasetRecord(id, 'revision', { record, attachments: [] });
    const file = await protocol.publish(`revision:${record.revisionId}`, parentId, value);
    const receipt = await protocol.publish(`change:${record.revisionId}`, folders.shards[file.shard], datasetRecord(id, 'change', { revision: file }));
    return { file, receipt };
  }
  return { store, protocol, plan, descriptor, change, folder };
}

test('typed queries and metadata enforce scope, property bounds, identities and checksums', async () => {
  const f = await fixture(), record = note('one', 'r1'), { file } = await f.change(record);
  const meta = { ...datasetMetadata(file), spaces: ['appDataFolder'], size: String(file.size), sha256Checksum: file.sha256 };
  assert.deepEqual(googleDatasetDescriptor(meta), file);
  assert.throws(() => googleDatasetDescriptor({ ...meta, parents: ['wrong', 'extra'] }), { code: 'invalid-dataset' });
  assert.throws(() => validateDatasetFile({ ...file, revisionId: 'a'.repeat(128) }), { code: 'invalid-dataset' });
  assert.throws(() => datasetQuery({ scope: 'current', datasetId: f.plan.datasetId, shard: "' or true" }), { code: 'invalid-dataset' });
  assert.throws(() => datasetQuery({ scope: 'legacy', q: 'anything' }), { code: 'invalid-dataset' });
  const query = datasetQuery({ scope: 'current', datasetId: f.plan.datasetId, shard: file.shard });
  assert.match(query, /checkpoint/); assert.match(query, /change/); assert.doesNotMatch(query, /value='revision'/);
  const bytes = new Uint8Array(f.store.files.get(file.id).bytes); bytes[0] ^= 1;
  await assert.rejects(decodeDatasetRecord(file, bytes), { code: 'file-integrity' });
});

test('two concurrent checkpoint writers preserve branches, retire only exact inputs and retain one history body per save', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one');
  const base = await f.change(note('one', 'r10'));
  const original = await f.protocol.captureShard(f.plan, shard);
  const left = await f.change(note('one', 'r11', ['r10']));
  const a = await f.protocol.captureShard(f.plan, shard);
  const right = await f.change(note('one', 'r12', ['r10']));
  const b = (await f.protocol.captureShard(f.plan, shard)).filter(input => input.file.id !== left.receipt.id);
  const other = new DatasetProtocol(f.store, new DatasetTestJournal());
  const ca = await f.protocol.checkpoint(f.plan, shard, a), cb = await other.checkpoint(f.plan, shard, b);
  await f.protocol.retire(f.descriptor, f.plan, ca); await other.retire(f.descriptor, f.plan, cb);
  assert.ok(f.store.files.has(ca.file.id) && f.store.files.has(cb.file.id));
  const merged = await f.protocol.captureShard(f.plan, shard);
  assert.deepEqual(mergeDatasetInputs(merged).map(head => head.record.revisionId), ['r11', 'r12']);
  const final = await f.protocol.checkpoint(f.plan, shard, merged); await f.protocol.retire(f.descriptor, f.plan, final);
  assert.equal((await f.protocol.captureShard(f.plan, shard)).length, 1);
  for (const { file } of [base, left, right]) assert.ok(f.store.files.has(file.id), 'retirement must retain history');
  assert.equal(original.length, 2);
});

test('bootstrap captures the token before listing and recovers a checkpoint retired during its GET', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one');
  await f.change(note('one', 'r1'));
  const old = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  await f.protocol.retire(f.descriptor, f.plan, old);
  let raced = false, tokenSeen = false;
  f.store.hook = async (operation, target) => {
    if (operation === 'cursor') tokenSeen = true;
    if (operation === 'list' && target.scope === 'current') assert.ok(tokenSeen);
    if (operation === 'read' && target === old.file.id && !raced) {
      raced = true; f.store.hook = async () => {};
      await f.change(note('one', 'r2', ['r1']));
      const next = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
      await f.protocol.retire(f.descriptor, f.plan, next);
    }
  };
  const state = await f.protocol.reconcile(f.descriptor, f.plan);
  assert.ok(raced && state.complete); assert.deepEqual(state.heads.map(head => head.record.revisionId), ['r2']);
  assert.equal(state.cursor, String(f.store.events.length));
});

test('a lost upload reply retries the exact journaled ID and cannot delete inputs before verified publication', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'); await f.change(note('one', 'r1'));
  const inputs = await f.protocol.captureShard(f.plan, shard);
  let failed = false;
  f.store.hook = async operation => { if (operation === 'create-after' && !failed) {
    failed = true; throw Object.assign(new Error('lost reply'), { code: 'network' }); } };
  const checkpoint = await f.protocol.checkpoint(f.plan, shard, inputs);
  assert.ok(failed); assert.ok(inputs.every(input => f.store.files.has(input.file.id)));
  const count = f.store.stats.creates;
  const file = await f.protocol.publish(checkpoint.key, f.plan.folders.shards[shard], checkpoint.value);
  assert.equal(file.id, checkpoint.file.id); assert.equal(f.store.stats.creates, count);
  f.store.hook = async operation => { if (operation === 'read') throw new Error('offline'); };
  await assert.rejects(f.protocol.retire(f.descriptor, f.plan, checkpoint), /offline/);
  assert.ok(inputs.every(input => f.store.files.has(input.file.id)));
});

test('terminal purge hides an offline branch and prevents a dirty checkpoint from retiring inputs', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'), original = await f.change(note('one', 'r1'));
  const checkpoint = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  const purge = datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: 'one', folderIds: [original.file.parentId], trashEpisode: 'episode', heads: ['r1'] });
  await f.protocol.publish('purge:one', f.plan.folders.buckets[shard], purge);
  assert.equal(await f.protocol.retire(f.descriptor, f.plan, checkpoint), false);
  await f.change(note('one', 'offline', ['ancient']));
  const state = await f.protocol.reconcile(f.descriptor, f.plan, { localEntities: ['one'] });
  assert.equal(state.heads.length, 0); assert.equal(state.purges.length, 1);
  // The same interrupted publisher sanitizes its pending output before retiring any captured file.
  const clean = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  assert.deepEqual(clean.value.heads, []); assert.equal(await f.protocol.retire(f.descriptor, f.plan, clean), true);
});

test('a pending checkpoint retired before its acknowledgement reacquires current candidates instead of replaying stale inputs', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'); await f.change(note('one', 'r1'));
  const old = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  const follower = new DatasetProtocol(f.store, new DatasetTestJournal());
  await f.change(note('one', 'r2', ['r1']));
  const next = await follower.checkpoint(f.plan, shard, await follower.captureShard(f.plan, shard));
  await follower.retire(f.descriptor, f.plan, next);
  assert.equal(f.store.files.has(old.file.id), false);
  const resumed = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  assert.equal(resumed.file.id, next.file.id);
  assert.equal(f.store.files.has(old.file.id), false);
  assert.deepEqual(resumed.value.heads.map(head => head.record.revisionId), ['r2']);
});

test('eight incomparable outputs can consolidate at the admission ceiling without unbounded retry publications', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'); await f.change(note('one', 'r1'));
  const clients = Array.from({ length: 8 }, () => new DatasetProtocol(f.store, new DatasetTestJournal()));
  let inputs = await f.protocol.captureShard(f.plan, shard);
  let outputs = [];
  for (const client of clients) outputs.push(await client.checkpoint(f.plan, shard, inputs));
  for (let i = 0; i < clients.length; i++) await clients[i].retire(f.descriptor, f.plan, outputs[i]);
  inputs = await f.protocol.captureShard(f.plan, shard); assert.equal(inputs.length, 8);
  outputs = [];
  for (const client of clients) outputs.push(await client.checkpoint(f.plan, shard, inputs));
  assert.equal((await f.protocol.captureShard(f.plan, shard)).length, 16);
  const before = f.store.stats.creates;
  for (let i = 0; i < clients.length; i++) assert.equal((await clients[i].checkpoint(f.plan, shard, inputs)).file.id, outputs[i].file.id);
  assert.equal(f.store.stats.creates, before);
  for (let i = 0; i < clients.length; i++) await clients[i].retire(f.descriptor, f.plan, outputs[i]);
  const final = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  await f.protocol.retire(f.descriptor, f.plan, final);
  assert.equal((await f.protocol.captureShard(f.plan, shard)).length, 1);
});

test('cold login work is independent of 10k, 100k and one million retained historical bodies', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one');
  await f.change(note('one', 'r1000000', ['old']));
  const checkpoint = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  await f.protocol.retire(f.descriptor, f.plan, checkpoint);
  f.store.forbiddenHistory = true;
  const costs = [];
  for (const count of [10_000, 100_000, 1_000_000]) {
    f.store.unrelatedHistory = count; const before = copyStats(f.store.stats);
    const state = await f.protocol.reconcile(f.descriptor, f.plan);
    assert.equal(state.heads.length, 1); assert.ok(state.complete);
    costs.push(Object.fromEntries(Object.keys(before).map(key => [key, f.store.stats[key] - before[key]])));
  }
  assert.deepEqual(costs[0], costs[1]); assert.deepEqual(costs[1], costs[2]); assert.equal(costs[0].historyReads, 0);
});
const copyStats = value => structuredClone(value);

test('cloud loss and a changed immutable input fail without automatic republishing', async () => {
  const f = await fixture();
  await f.store.deleteFile({ id: f.plan.rootId }); const before = f.store.stats.creates;
  await assert.rejects(f.protocol.reconcile(f.descriptor, f.plan), { code: 'dataset-changed' });
  assert.equal(f.store.stats.creates, before);
});

test('a terminal purge permits cold login while its now-missing history body still has a current receipt', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'), original = await f.change(note('one', 'r1'));
  const purge = datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: 'one', folderIds: [original.file.parentId], trashEpisode: 'episode', heads: ['r1'] });
  await f.protocol.publish('purge:one', f.plan.folders.buckets[shard], purge);
  await f.store.deleteFile({ id: original.file.parentId });
  const state = await f.protocol.reconcile(f.descriptor, f.plan);
  assert.ok(state.complete); assert.deepEqual(state.heads, []);
});

test('false coverage, changed captured bytes and cross-shard inputs cannot authorize retirement', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'); await f.change(note('one', 'r1'));
  const inputs = await f.protocol.captureShard(f.plan, shard);
  const altered = structuredClone(inputs);
  altered.find(input => input.head).head.record.value.content.text = 'different';
  await assert.rejects(f.protocol.checkpoint(f.plan, shard, altered), { code: 'file-integrity' });
  const checkpoint = await f.protocol.checkpoint(f.plan, shard, inputs);
  const bad = structuredClone(checkpoint); bad.value.inputs[0].sha256 = '0'.repeat(64);
  assert.throws(() => mergeDatasetInputs([...inputs, bad]), { code: 'invalid-dataset' });
  const other = await f.protocol.captureShard(f.plan, shard === '0' ? '1' : '0');
  assert.throws(() => mergeDatasetInputs([...inputs, ...other]), { code: 'invalid-dataset' });
  assert.ok(inputs.every(input => f.store.files.has(input.file.id)));
});

test('every publication/retirement interruption preserves current data and a later pass finishes safely', async () => {
  const baseline = await fixture(), shard = await datasetShard('card', 'one'); await baseline.change(note('one', 'r1'));
  const trace = [];
  baseline.store.hook = async (operation, target) => trace.push([operation, target]);
  const prepared = await baseline.protocol.checkpoint(baseline.plan, shard, await baseline.protocol.captureShard(baseline.plan, shard));
  await baseline.protocol.retire(baseline.descriptor, baseline.plan, prepared);
  for (let failAt = 0; failAt < trace.length; failAt++) {
    const f = await fixture(); await f.change(note('one', 'r1')); let step = 0;
    f.store.hook = async () => { if (step++ === failAt) throw new Error('interrupted'); };
    try {
      const next = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
      await f.protocol.retire(f.descriptor, f.plan, next);
    } catch (error) { assert.equal(error.message, 'interrupted'); }
    f.store.hook = async () => {};
    const state = await f.protocol.reconcile(f.descriptor, f.plan);
    assert.deepEqual(state.heads.map(head => head.record.revisionId), ['r1'], `interruption ${failAt}: ${trace[failAt][0]}`);
    const next = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
    assert.ok(await f.protocol.retire(f.descriptor, f.plan, next));
    assert.equal((await f.protocol.captureShard(f.plan, shard)).length, 1);
  }
});

test('a long irrelevant deletion feed yields a usable view without advancing its cursor', async () => {
  const f = await fixture(), shard = await datasetShard('card', 'one'); await f.change(note('one', 'r1'));
  const checkpoint = await f.protocol.checkpoint(f.plan, shard, await f.protocol.captureShard(f.plan, shard));
  await f.protocol.retire(f.descriptor, f.plan, checkpoint);
  let added = false;
  f.store.hook = async operation => {
    if (operation === 'changes' && !added) {
      added = true;
      f.store.events.push(...Array.from({ length: 1200 }, (_, i) => ({ id: `old-history-${i}`, removed: true })));
    }
  };
  const pending = await f.protocol.reconcile(f.descriptor, f.plan);
  assert.equal(pending.complete, false); assert.equal(pending.cursor, null);
  assert.deepEqual(pending.heads.map(head => head.record.revisionId), ['r1']);
  const resumed = await f.protocol.reconcile(f.descriptor, f.plan);
  assert.ok(resumed.complete); assert.equal(resumed.cursor, String(f.store.events.length));
});
