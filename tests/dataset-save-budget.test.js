import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { ensureDatasetDirectory } from '../src/sources/dataset-folders.js';
import { DATASET_LIMITS, DATASET_SHARDS, datasetRecord, datasetShard } from '../src/sources/dataset-codec.js';
import { sha256 } from '../src/sources/files.js';
import { DatasetTestJournal, DatasetTestProvider } from './fixtures/dataset/provider.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });

/** A drained account with one note and every shard folder present, so no count includes sparse first use. */
async function steady() {
  const provider = new DatasetTestProvider(), records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'google:test');
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId: 'test', area, current: true,
    bootstrapGroup: false, persist: (...args) => storage.save(...args) });
  const f = { provider, storage, workspace, calls: [], faultAt: -1, fault: null, gate: null };
  const counted = new Proxy(provider, { get(target, key) {
    const value = Reflect.get(target, key, target);
    return typeof value !== 'function' ? value : async (...args) => {
      // Parallel requests need their own positions, and every request from the fault onward has to observe it.
      const at = f.calls.push({ method: key, args }) - 1;
      if (at === f.faultAt) f.gate = f.fault();
      await f.gate;
      return value.apply(target, args);
    };
  } });
  f.sync = new DatasetSync({ workspace, storage, fileStore: counted });
  await f.sync.sync();
  f.plan = f.sync.binding.plan;
  for (const shard of DATASET_SHARDS) await ensureDatasetDirectory(provider, f.plan, f.plan.folders.shards[shard]);
  f.card = await workspace.createCard(content('existing'));
  while (workspace.pendingCount) await f.sync.sync();
  await f.sync.sync();
  f.calls.length = 0;
  return f;
}
const addFence = async f => {
  const bytes = new TextEncoder().encode('{}');
  f.provider.files.set('foreign-fence', { file: { id: 'foreign-fence', kind: 'reset', size: bytes.length, sha256: await sha256(bytes) }, bytes });
};
const isWrite = call => ['createObject', 'createFolder'].includes(call.method);
const isFenceList = call => call.method === 'listObjects' && call.args[0].query.scope === 'fences';
const isPurgeList = (call, id) => call.method === 'listObjects' && call.args[0].query.scope === 'purges' && call.args[0].query.entities.includes(id);
const isReceipt = call => call.method === 'createObject' && call.args[0].file.kind === 'change';
// Reading the ready receipt is the last request of a generation proof and nothing else in a save reads it.
const isProof = (f, call) => call.method === 'readObject' && call.args[0].file.id === f.plan.readyId;
const proofs = f => f.calls.filter(call => isProof(f, call)).length;
const edit = f => f.workspace.updateCard(f.card.id, { content: content('edited') }, f.card.revision);
const create = f => f.workspace.createCard(content('new'));
const twoSaves = async f => { await edit(f); await create(f); };
const rename = f => { const group = f.workspace.snapshot.groups[0]; return f.workspace.renameGroup(group.id, 'renamed', group.revision); };
const attach = async f => {
  const bytes = new TextEncoder().encode('attached'), id = await sha256(bytes);
  await f.storage.putAttachmentBytes('google:test', id, bytes);
  return f.workspace.createCard({ ...content('with file'), attachments: [{ id, size: bytes.length, name: 'example.txt', mediaType: 'text/plain' }] });
};
const indexes = (f, match) => f.calls.flatMap((call, index) => match(call) ? [index] : []);

test('one save stays inside its provider-call budget', async () => {
  let f = await steady();
  const note = await create(f); await f.sync.sync();
  assert.equal(proofs(f), 7, 'a new note: before the feed, before activation, before folder, body and receipt, after the receipt, and after the last read');
  // Sharing the existing note's shard adds that note's receipt and body to the capture; the random ID decides, so name both cases.
  const shared = await datasetShard('card', note.id) === await datasetShard('card', f.card.id);
  assert.ok(f.calls.length <= (shared ? 81 : 79), `a new note used ${f.calls.length} provider calls`);
  f = await steady();
  await edit(f); await f.sync.sync();
  assert.equal(proofs(f), 6, 'an edit reuses its existing note folder');
  assert.ok(f.calls.length <= 68, `an edit used ${f.calls.length} provider calls`);
});

test('queued saves share the proof left by the previous publication', async () => {
  const f = await steady();
  for (let i = 0; i < 10; i++) await f.workspace.createCard(content(`queued ${i}`));
  await f.sync.sync();
  assert.equal(f.workspace.pendingCount, 0);
  assert.equal(proofs(f), 43, 'two around the first pull, four per new note and one closing the last pull');
});

test('every write has a fresh proof and every receipt is rechecked, with purge checks for notes', async () => {
  for (const [name, change, note] of [['new note', create, true], ['edit', edit, true], ['note with an attachment', attach, true],
    ['two saves', twoSaves, true], ['group rename', rename, false]]) {
    const f = await steady();
    await change(f); await f.sync.sync();
    assert.equal(f.workspace.pendingCount, 0, name);
    const writes = indexes(f, isWrite);
    assert.ok(writes.length >= 2, name);
    for (const at of writes) {
      const since = f.calls.slice(f.calls.slice(0, at).findLastIndex(call => isProof(f, call)) + 1, at), { entityId } = f.calls[at].args[0].file;
      // Only the guard's own purge listing and a parent-folder read may separate its proof from the write.
      assert.ok(since.length <= 2, `${name}: request ${at} writes ${since.length} requests after its proof`);
      if (note) assert.ok(since.some(call => isPurgeList(call, entityId)), `${name}: request ${at} has no purge check`);
    }
    for (const at of indexes(f, isReceipt)) {
      // Next come the receipt's read-back, a note's purge listing and the seven requests of a proof.
      const closing = f.calls.slice(at + 1, at + 10), { entityId } = f.calls[at].args[0].file;
      assert.ok(closing.some(call => isProof(f, call)), `${name}: request ${at} is never rechecked`);
      if (note) assert.ok(closing.some(call => isPurgeList(call, entityId)), `${name}: request ${at} has no closing purge check`);
    }
    assert.ok(isProof(f, f.calls.at(-1)), `${name}: activation needs a proof newer than everything the pull read`);
  }
});

test('a reused proof still leaves each note its opening purge check', async () => {
  const f = await steady();
  await edit(f); const added = await create(f); await f.sync.sync();
  const at = indexes(f, call => isProof(f, call));
  assert.ok(isPurgeList(f.calls[at[1] + 1], f.card.id), 'the first operation follows the proof that closed the pull');
  assert.ok(isPurgeList(f.calls[at[4] + 1], added.id), 'the next operation follows the proof that closed the previous one');
});

test('a checkpoint is proved after capturing its inputs', async () => {
  const f = await steady();
  let card = f.card;
  for (let i = 0; i < DATASET_LIMITS.tailSoft; i++) card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  while (f.workspace.pendingCount) await f.sync.sync({ force: true });
  const at = indexes(f, call => call.method === 'createObject' && call.args[0].file.kind === 'checkpoint')[0];
  assert.ok(at >= 0, 'reaching the tail limit starts a consolidation');
  const before = f.calls.slice(0, at);
  const capture = before.findLastIndex(call => call.method === 'listObjects' && call.args[0].query.scope === 'current');
  assert.ok(before.findLastIndex(call => isProof(f, call)) > capture);
});

test('a fence arriving after a checkpoint is published stops its inputs being retired', async () => {
  const f = await steady();
  let card = f.card;
  for (let i = 0; i < DATASET_LIMITS.tailSoft; i++) card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  f.provider.hook = async (point, id) => { if (point === 'create-after' && f.provider.files.get(id)?.file.kind === 'checkpoint') await addFence(f); };
  let failure = null;
  while (f.workspace.pendingCount && !failure) try { await f.sync.sync({ force: true }); } catch (error) { failure = error; }
  assert.equal(failure?.code, 'dataset-changed');
  assert.ok(f.calls.some(call => call.method === 'createObject' && call.args[0].file.kind === 'checkpoint'));
  assert.ok(!f.calls.some(call => call.method === 'deleteFile'));
});

for (const [kind, change] of [['note', edit], ['group', rename]]) {
  for (const [name, interrupt, code] of [['a foreign fence', f => addFence(f), 'dataset-changed'], ['a stopped session', f => f.sync.stop({ endSession: false }), 'stale-session']]) {
    test(`${name} during the activation that finds an uncertain ${kind} receipt covered keeps the operation pending`, async () => {
      const f = await steady(); let lost = false;
      await change(f);
      f.provider.hook = async (point, id) => {
        if (point === 'create-after' && !lost && f.provider.files.get(id)?.file.kind === 'change') {
          lost = true; throw Object.assign(new Error('reply lost'), { code: 'service-unavailable' });
        }
      };
      await assert.rejects(f.sync.sync(), { code: 'service-unavailable' });
      f.provider.hook = async () => {};
      const receive = f.workspace.receiveDataset.bind(f.workspace); let activations = 0;
      // The pass activates once for its opening pull and again for the pull that decides coverage.
      f.workspace.receiveDataset = async (...args) => { const result = await receive(...args); if (++activations === 2) await interrupt(f); return result; };
      await assert.rejects(f.sync.sync({ force: true }), { code });
      assert.equal(activations, 2);
      assert.equal(f.workspace.pendingCount, 1);
    });
  }
}

test('a proof never carries over into the next pass', async () => {
  const f = await steady();
  // No idle check in between: the first pass ends on a proof and nothing has asked the provider anything since.
  await create(f); await f.sync.sync();
  f.calls.length = 0;
  await create(f);
  await f.provider.deleteFile({ id: f.plan.rootId });
  await assert.rejects(f.sync.sync(), { code: 'dataset-changed' });
  assert.ok(!f.calls.some(call => call.method === 'listDatasetChanges'), 'the pass proves the generation before reading the feed');
  assert.ok(!f.calls.some(isWrite));
  assert.equal(f.workspace.pendingCount, 1);
});

/** Runs one pass per request position, with the fault applied just before that request. */
async function atEveryRequest(prepare, fault, verify) {
  for (let k = 0; ; k++) {
    const f = await steady(), state = await prepare(f);
    f.calls.length = 0; f.faultAt = k; f.fault = () => fault(f, state);
    let failure = null;
    try { await f.sync.sync(); } catch (error) { failure = error; }
    f.faultAt = -1;
    if (f.calls.length <= k) { assert.ok(k > 40, `only ${k} request positions were exercised`); return; }
    await verify(f, k, failure, state);
    await f.sync.stop();
  }
}

// The fence is the stricter fault, because only a generation proof can see it.
for (const [name, lose, saves] of [['the ready receipt disappears', f => f.provider.deleteFile({ id: f.plan.readyId }), [['edit', edit]]],
  ['a foreign fence appears, unseen by the feed', addFence, [['new note', create], ['edit', edit], ['two saves', twoSaves], ['group rename', rename]]]]) for (const [label, change] of saves) {
  test(`when ${name} at any request of a save (${label}), nothing further is published or acknowledged`, () => atEveryRequest(
    async f => { await change(f); return { before: f.workspace.pendingCount }; }, lose, (f, k, failure, { before }) => {
      const context = `${name}, ${label}, request ${k} of ${f.calls.length}: `;
      // A proof that already passed can precede the loss by one write; there is no provider transaction to prevent that.
      assert.ok(f.calls.slice(k).filter(isWrite).length <= 1, `${context}wrote after the loss`);
      if (failure) assert.equal(failure.code, 'dataset-changed', `${context}${failure.code}`);
      else assert.ok(!f.calls.slice(k).some(isFenceList), `${context}a later fence listing should have stopped the pass`);
      // An acknowledged operation needs a receipt that a later proof saw, before the loss could affect that proof.
      const receipts = f.calls.slice(0, k).flatMap((call, index) => isReceipt(call) ? [index] : []);
      const proven = receipts.filter(at => f.calls.slice(at + 1, k).some(isFenceList)).length;
      assert.ok(before - f.workspace.pendingCount <= proven, `${context}acknowledged without a proof after its receipt`);
    }));
}

test('when the dataset root disappears at any request of an edit, the next pass at the latest reports the reset', () => atEveryRequest(
  edit, f => f.provider.deleteFile({ id: f.plan.rootId }),
  async (f, k, failure) => {
    const context = `request ${k} of ${f.calls.length}: `;
    assert.ok(failure, context);
    if (failure.code === 'dataset-changed') return;
    // Part of the tree can vanish between a listing and its read, which is reported as ordinary retryable work once.
    assert.ok(['dataset-visibility', 'source-file-missing'].includes(failure.code), `${context}${failure.code}`);
    await assert.rejects(f.sync.sync({ force: true }), { code: 'dataset-changed' }, context);
  }));

test('a permanent deletion arriving at any request of an edit never brings the note back', () => atEveryRequest(
  async f => {
    await edit(f);
    const shard = await datasetShard('card', f.card.id), parent = f.plan.folders.buckets[shard];
    await ensureDatasetDirectory(f.provider, f.plan, parent);
    return { parent, protocol: new DatasetProtocol(f.provider, new DatasetTestJournal()),
      marker: datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: f.card.id,
        folderIds: [], trashEpisode: crypto.randomUUID(), heads: [f.card.revision] }) };
  },
  (f, { protocol, parent, marker }) => protocol.publish('purge', parent, marker),
  async (f, k, failure) => {
    const context = `request ${k} of ${f.calls.length}: `;
    assert.equal(failure, null, context);
    assert.ok(f.calls.slice(k).filter(isWrite).length <= 1, `${context}wrote after the deletion`);
    await f.sync.sync({ force: true });
    assert.ok(!f.workspace.snapshot.cards.some(card => card.id === f.card.id), `${context}the note came back`);
    assert.equal(f.workspace.pendingCount, 0, context);
  }));
