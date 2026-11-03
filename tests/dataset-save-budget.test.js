import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { VerifiedRecords } from '../src/sources/dataset-records.js';
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
  f.counted = counted;
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
// The dataset listing is the last request of a generation proof once its bytes are known, and nothing else in a save asks it.
const isProof = (f, call) => call.method === 'listObjects' && call.args[0].query.scope === 'datasets';
const proofs = f => f.calls.filter(call => isProof(f, call)).length;
const edit = f => f.workspace.updateCard(f.card.id, { content: content('edited') }, f.card.revision);
const edit2 = f => f.workspace.updateCard(f.card.id, { content: content('edited again') }, f.workspace.snapshot.cards.find(card => card.id === f.card.id).revision);
/** A second device on the same account, syncing through its own store so a test can observe or slow it. */
async function deviceOn(f, through = f.provider, options = {}) {
  const records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'google:test');
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId: 'other', area, current: true,
    bootstrapGroup: false, persist: (...args) => storage.save(...args) });
  const device = { workspace, storage, calls: [] };
  const counted = new Proxy(through, { get(target, key) {
    const value = Reflect.get(target, key, target);
    return typeof value !== 'function' ? value : async (...args) => { device.calls.push({ method: key, args }); return value.apply(target, args); };
  } });
  device.sync = new DatasetSync({ workspace, storage, fileStore: counted, ...options });
  return device;
}
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
  await create(f); await f.sync.sync();
  assert.equal(proofs(f), 7, 'a new note: before the feed, before activation, before folder, body and receipt, after the receipt, and after the last read');
  assert.ok(f.calls.length <= 57, `a new note used ${f.calls.length} provider calls`);
  f = await steady();
  await edit(f); await f.sync.sync();
  assert.equal(proofs(f), 6, 'an edit reuses its existing note folder');
  assert.ok(f.calls.length <= 48, `an edit used ${f.calls.length} provider calls`);
});

test("a save's cost does not grow with the saves before it", async () => {
  const f = await steady(); let card = f.card;
  const editOnce = async text => {
    card = await f.workspace.updateCard(card.id, { content: content(text) }, card.revision);
    f.calls.length = 0; await f.sync.sync();
    return { all: f.calls.length, reads: f.calls.filter(call => call.method === 'readObject').length };
  };
  const first = await editOnce('first');
  for (let i = 0; i < 20; i++) await editOnce(`edit ${i}`);
  const last = await editOnce('last');
  assert.deepEqual(last, first);
  assert.equal(last.reads, 2, 'only the read-backs of the two files this save wrote');
});

test('every proof asks what exists again, and reads its two records once per session', async () => {
  const f = await steady(), isOwnRead = call => call.method === 'readObject' && [f.plan.readyId, f.sync.binding.descriptor.id].includes(call.args[0].file.id);
  await edit(f); await f.sync.sync();
  assert.equal(f.calls.filter(isOwnRead).length, 0, 'this session already read them');
  const count = (method, match) => f.calls.filter(call => call.method === method && match(call.args[0])).length;
  for (const id of [f.plan.rootId, f.plan.readyId, f.sync.binding.descriptor.id]) assert.equal(count('getObject', input => input.id === id), proofs(f));
  for (const scope of ['fences', 'datasets']) assert.equal(count('listObjects', input => input.query.scope === scope), proofs(f));

  const session = new DatasetSync({ workspace: f.workspace, storage: f.storage, fileStore: f.counted });
  await f.sync.stop({ endSession: false });
  await f.workspace.updateCard(f.card.id, { content: content('after a restart') }, f.workspace.snapshot.cards.find(card => card.id === f.card.id).revision);
  f.calls.length = 0; await session.sync();
  assert.equal(f.calls.filter(isOwnRead).length, 2, 'a new session verifies them itself');
  await session.stop();
});

test('a record whose digest changed on Drive is never answered from memory', async () => {
  const f = await steady(), ready = f.provider.files.get(f.plan.readyId);
  await edit(f); await f.sync.sync(); f.calls.length = 0;
  await edit2(f);
  f.provider.files.set(f.plan.readyId, { ...ready, file: { ...ready.file, sha256: 'a'.repeat(64) } });
  await assert.rejects(f.sync.sync(), { code: 'file-integrity' });
  assert.ok(f.calls.some(call => call.method === 'readObject' && call.args[0].file.id === f.plan.readyId));
  assert.ok(!f.calls.some(isWrite));
});

test('a pull reads what it has not verified yet, and the listing decides what exists', async () => {
  const f = await steady(), other = await deviceOn(f); await other.sync.sync(); await other.sync.sync();
  await edit(f); await f.sync.sync();
  other.calls.length = 0; await other.sync.sync();
  assert.equal(other.calls.filter(call => call.method === 'readObject').length, 2, 'the new receipt and its revision');
  assert.equal(other.workspace.snapshot.cards[0].content.text, 'edited');
  // A file gone from the listing stops counting, whatever memory holds.
  const stale = f.calls.find(isReceipt).args[0].file.id;
  await f.provider.deleteFile({ id: stale });
  other.calls.length = 0; await other.sync.sync({ force: true });
  assert.ok(!other.calls.some(call => call.method === 'readObject' && call.args[0].file.id === stale));
  const view = await Promise.all(Object.values(other.workspace.syncState.datasetView).map(key => other.storage.getControl(key)));
  assert.ok(!view.flatMap(shard => shard.inputs).some(file => file.id === stale));
});

test('a checkpoint reads its inputs again, so it cannot seal a head whose body is gone', async () => {
  const f = await steady(); let card = f.card;
  card = await f.workspace.updateCard(card.id, { content: content('body lost later') }, card.revision);
  await f.sync.sync();
  const body = [...f.provider.files.values()].find(item => item.file.kind === 'revision' && item.file.revisionId === card.revision);
  f.provider.files.delete(body.file.id);
  card = await f.workspace.updateCard(card.id, { content: content('still fine from memory') }, card.revision);
  await f.sync.sync();
  assert.equal(f.workspace.pendingCount, 0, 'an ordinary pull reuses what it verified');
  let failure = null;
  for (let i = 0; i < DATASET_LIMITS.tailSoft && !failure; i++) {
    card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
    try { await f.sync.sync({ force: true }); } catch (error) { failure = error; }
  }
  assert.equal(failure?.code, 'source-file-missing');
  assert.ok(!f.calls.some(call => call.method === 'createObject' && call.args[0].file.kind === 'checkpoint'));
});

test('reads run one at a time on a host that asks for that', async () => {
  const f = await steady(); let card = f.card, open = 0, widest = 0;
  for (let i = 0; i < 6; i++) card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  while (f.workspace.pendingCount) await f.sync.sync();
  const serial = new Proxy(f.provider, { get(target, key) {
    if (key === 'readWidth') return 1;
    const value = Reflect.get(target, key, target);
    if (key !== 'readObject') return typeof value === 'function' ? value.bind(target) : value;
    return async input => { open++; widest = Math.max(widest, open); await new Promise(resolve => setTimeout(resolve, 1)); open--; return value.call(target, input); };
  } });
  const other = await deviceOn(f, serial); await other.sync.sync();
  assert.equal(widest, 1);
});

test('reads run at most four at a time, and none outlives a failed capture', async () => {
  const f = await steady(); let card = f.card;
  // One note's edits all land in one shard, so its capture has more to read than the limit allows at once.
  for (let i = 0; i < 12; i++) card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  while (f.workspace.pendingCount) await f.sync.sync();
  let open = 0, widest = 0, started = 0, failAt = Infinity;
  const slow = new Proxy(f.provider, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'readObject') return typeof value === 'function' ? value.bind(target) : value;
    return async input => {
      // Counts one kind of file, so the failure lands inside a capture, and fails at once while the others are still out.
      const at = input.file.kind === 'change' ? ++started : 0;
      if (at === failAt) throw Object.assign(new Error('lost'), { code: 'network' });
      open++; widest = Math.max(widest, open);
      await new Promise(resolve => setTimeout(resolve, 5));
      open--;
      return value.call(target, input);
    };
  } });
  const other = await deviceOn(f, slow); await other.sync.sync();
  assert.equal(widest, 4, 'a capture reads in parallel, four at a time');
  const late = await deviceOn(f, slow); started = 0; failAt = 3;
  await assert.rejects(late.sync.sync(), { code: 'network' });
  assert.equal(open, 0, 'every started read had ended when the pass failed');
  const atFailure = started; await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(started, atFailure, 'and no further read starts');
  assert.ok(atFailure <= failAt + 3, `the failure stopped new reads, but ${atFailure} started`);
});

/** Another device's work, with this device's listings still answering from before it. */
async function lagging(options = {}) {
  const f = await steady(), frozen = new Map(), lag = { on: false, rounds: Infinity };
  const behind = new Proxy(f.provider, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'listObjects') return typeof value === 'function' ? value.bind(target) : value;
    return async input => {
      const query = JSON.stringify(input.query);
      if (lag.on && lag.rounds > 0 && frozen.has(query) && ['current', 'purges'].includes(input.query.scope)) {
        if (input.query.scope === 'current') lag.rounds--;
        return structuredClone(frozen.get(query));
      }
      const page = await value.call(target, input); frozen.set(query, structuredClone(page)); return page;
    };
  } });
  const other = await deviceOn(f, behind, options); await other.sync.sync(); await other.sync.sync();
  await edit(f); await f.sync.sync(); await f.sync.sync();
  await other.sync.sync(); await other.sync.sync();
  return { f, other, lag };
}
const edited = (d, id) => d.workspace.snapshot.cards.find(card => card.id === id)?.content.text ?? null;

test('a listing that lags the feed holds the cursor, whether it lacks a new file or still names a retired one', async () => {
  for (const name of ['new receipt not listed yet', 'retired input still listed']) {
    const { f, other, lag } = await lagging(), { plan, descriptor } = f.sync.binding, id = f.card.id;
    await f.workspace.updateCard(id, { content: content('from the other device') }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
    await f.sync.sync();
    if (name === 'retired input still listed') {
      const protocol = new DatasetProtocol(f.provider, new DatasetTestJournal()), shard = await datasetShard('card', id);
      await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, await protocol.captureShard(plan, shard)));
    }
    const cursor = other.workspace.syncState.cursor;
    lag.on = true;
    await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' }, name);
    assert.equal(other.workspace.syncState.cursor, cursor, name);
    assert.equal(other.sync.status.phase, 'backoff', name);
    lag.on = false;
    await other.sync.sync({ force: true });
    assert.equal(edited(other, id), 'from the other device', name);
  }
});

test('a listing that still names a file the feed removed holds the cursor', async () => {
  const { f, other, lag } = await lagging(), receipt = f.calls.findLast(isReceipt).args[0].file.id;
  await f.provider.deleteFile({ id: receipt });
  const cursor = other.workspace.syncState.cursor;
  lag.on = true;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  assert.equal(other.workspace.syncState.cursor, cursor);
});

test('a file the feed removed and then added again is expected, not refused', async () => {
  const { f, other } = await lagging(), { file, bytes } = f.provider.files.get(f.calls.findLast(isReceipt).args[0].file.id);
  await f.provider.deleteFile({ id: file.id });
  await f.provider.createObject({ file, bytes });
  await other.sync.sync({ force: true });
  assert.equal(other.sync.status.phase, 'idle');
  assert.equal(edited(other, f.card.id), 'edited');
});

test('a marker the feed added and then removed is not expected', async () => {
  const { f, other } = await lagging(), parent = f.plan.folders.buckets[await datasetShard('card', f.card.id)];
  await ensureDatasetDirectory(f.provider, f.plan, parent);
  const marker = await new DatasetProtocol(f.provider, new DatasetTestJournal()).publish('purge', parent, datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: f.card.id,
    folderIds: [], trashEpisode: crypto.randomUUID(), heads: [f.card.revision] }));
  await f.provider.deleteFile({ id: marker.id });
  await other.sync.sync({ force: true });
  assert.equal(other.sync.status.phase, 'idle');
});

test('an unfinished feed does not hold a listing to what it has read so far', async () => {
  const { f, other, lag } = await lagging(), parent = f.plan.folders.buckets[await datasetShard('card', f.card.id)];
  await ensureDatasetDirectory(f.provider, f.plan, parent);
  lag.on = true;
  await new DatasetProtocol(f.provider, new DatasetTestJournal()).publish('purge', parent, datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: f.card.id,
    folderIds: [], trashEpisode: crypto.randomUUID(), heads: [f.card.revision] }));
  f.provider.events.push(...Array.from({ length: DATASET_LIMITS.feedEvents }, (_, at) => ({ id: `noise-${at}`, removed: true })));
  await other.sync.sync({ force: true });
  lag.on = false;
  await other.sync.sync({ force: true });
  assert.equal(edited(other, f.card.id), null, 'the next pass reads the rest');
});

test('an unfinished feed does not refuse a listing for naming what it removed', async () => {
  const { f, other, lag } = await lagging(), receipt = f.calls.findLast(isReceipt).args[0].file.id;
  await f.provider.deleteFile({ id: receipt });
  f.provider.events.push(...Array.from({ length: DATASET_LIMITS.feedEvents }, (_, at) => ({ id: `noise-${at}`, removed: true })));
  lag.on = true;
  await other.sync.sync({ force: true });
  assert.equal(other.workspace.syncState.cursor, null, 'an unfinished feed leaves the next pull to reconcile');
});

test('a listing that never agrees holds uploads for 30 seconds, however many passes ask', async () => {
  let clock = 1000;
  const { f, other, lag } = await lagging({ elapsed: () => clock }), id = f.card.id;
  const editFrom = text => f.workspace.updateCard(id, { content: content(text) }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  await editFrom('never listed'); await f.sync.sync();
  await other.workspace.createCard(content('waiting to upload'));
  lag.on = true;
  for (let i = 0; i < 8; i++) await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' }, `hold ${i}`);
  clock += 29_999;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  assert.equal(other.workspace.pendingCount, 1, 'held before any upload');
  clock += 1;
  // A pull after the upload can still meet the same listing. What matters is that the upload went.
  await other.sync.sync({ force: true }).catch(error => assert.equal(error.code, 'dataset-visibility'));
  assert.equal(other.workspace.pendingCount, 0, 'a full reconciliation lets the upload go');
});

test('after a reconciliation that stopped holding, another one corrects what the listing left out', async () => {
  let clock = 1000;
  const { f, other, lag } = await lagging({ elapsed: () => clock }), id = f.card.id;
  const editFrom = text => f.workspace.updateCard(id, { content: content(text) }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  await editFrom('left out at first'); await f.sync.sync();
  lag.on = true;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  clock += 30_000;
  await other.sync.sync({ force: true });
  lag.on = false;
  assert.notEqual(edited(other, id), 'left out at first', 'it landed what the listing showed');
  await assert.rejects(other.sync.syncWaiting({ force: true }), { code: 'dataset-visibility' }, 'and nobody waiting takes that as current');
  clock += 5 * 60 * 1000;
  await other.sync.sync();
  assert.equal(edited(other, id), 'left out at first');
  assert.equal((await other.sync.syncWaiting({ force: true })).phase, 'idle');
  other.calls.length = 0; await other.sync.sync();
  assert.ok(!other.calls.some(call => call.method === 'getStartCursor'), 'one follow-up is enough');
});

test('a follow-up that lands during a new hold is still owed', async () => {
  let clock = 1000;
  const { f, other, lag } = await lagging({ elapsed: () => clock }), id = f.card.id;
  const editFrom = text => f.workspace.updateCard(id, { content: content(text) }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  await editFrom('first'); await f.sync.sync();
  lag.on = true;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  clock += 30_000; await other.sync.sync({ force: true });
  lag.on = false; clock += 5 * 60 * 1000 - 10_000;
  await editFrom('second'); await f.sync.sync();
  lag.on = true;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  clock += 10_000; await other.sync.sync({ force: true });
  lag.on = false;
  assert.notEqual(edited(other, id), 'second', 'this follow-up met the same lag');
  clock += 5 * 60 * 1000; await other.sync.sync();
  assert.equal(edited(other, id), 'second');
});

test('an old hold or one followed by another failure does not end the next one early', async () => {
  let clock = 1000;
  const { f, other, lag } = await lagging({ elapsed: () => clock }), id = f.card.id;
  await f.workspace.updateCard(id, { content: content('later') }, f.workspace.snapshot.cards.find(card => card.id === id).revision); await f.sync.sync();
  const hold = async () => { lag.on = true; await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' }); lag.on = false; };
  await hold(); clock += 90_001;
  await hold();
  const hook = f.provider.hook; let once = true;
  f.provider.hook = async (point, ...rest) => { if (point === 'changes' && once) { once = false; throw Object.assign(new Error('offline'), { code: 'network' }); } return hook(point, ...rest); };
  await assert.rejects(other.sync.sync({ force: true }), { code: 'network' });
  clock += 40_000;
  await hold();
  assert.equal(other.sync.status.phase, 'backoff');
  await other.sync.sync({ force: true });
  assert.equal(edited(other, id), 'later');
  assert.equal((await other.sync.syncWaiting({ force: true })).phase, 'idle', 'no follow-up is owed, because nothing stopped holding');
});

test('a pull that gets through starts the 30 seconds again', async () => {
  let clock = 1000;
  const { f, other, lag } = await lagging({ elapsed: () => clock }), id = f.card.id;
  const editFrom = text => f.workspace.updateCard(id, { content: content(text) }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  const hold = async () => { lag.on = true; await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' }); lag.on = false; };
  await editFrom('one'); await f.sync.sync(); await hold(); clock += 20_000; await other.sync.sync({ force: true });
  assert.equal(edited(other, id), 'one');
  await editFrom('two'); await f.sync.sync(); await hold(); clock += 20_000; lag.on = true;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' }, 'only 20 seconds into this hold');
});

test('a pass someone is waiting on waits out a short lag, and gives up after three waits', async () => {
  const { f, other, lag } = await lagging(), id = f.card.id;
  const editFrom = text => f.workspace.updateCard(id, { content: content(text) }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  await editFrom('worth waiting for'); await f.sync.sync();
  lag.on = true; lag.rounds = 6;
  await other.sync.syncWaiting({ force: true });
  assert.equal(edited(other, id), 'worth waiting for');
  await editFrom('never shows'); await f.sync.sync();
  lag.on = true; lag.rounds = Infinity;
  let passes = 0; const sync = other.sync.sync.bind(other.sync);
  other.sync.sync = options => { passes++; return sync(options); };
  await assert.rejects(other.sync.syncWaiting({ force: true }), { code: 'dataset-visibility' });
  assert.equal(passes, 4);
});

test('a purge the feed reported waits for the listing to show it', async () => {
  const { f, other, lag } = await lagging(), id = f.card.id, shard = await datasetShard('card', id), parent = f.plan.folders.buckets[shard];
  await ensureDatasetDirectory(f.provider, f.plan, parent);
  const reader = new DatasetProtocol(f.provider, new DatasetTestJournal());
  await other.sync.sync({ force: true });
  lag.on = true;
  await reader.publish('purge', parent, datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: id,
    folderIds: [], trashEpisode: crypto.randomUUID(), heads: [f.workspace.snapshot.cards.find(card => card.id === id).revision] }));
  const cursor = other.workspace.syncState.cursor;
  await assert.rejects(other.sync.sync({ force: true }), { code: 'dataset-visibility' });
  assert.equal(other.workspace.syncState.cursor, cursor);
  lag.on = false;
  await other.sync.sync({ force: true });
  assert.equal(edited(other, id), null, 'the note is gone once the listing caught up');
});

test('a listing that catches up within its retries costs the pass nothing', async () => {
  const { f, other, lag } = await lagging(), id = f.card.id;
  await f.workspace.updateCard(id, { content: content('slightly late') }, f.workspace.snapshot.cards.find(card => card.id === id).revision);
  await f.sync.sync();
  lag.on = true; lag.rounds = 2;
  await other.sync.sync({ force: true });
  assert.equal(edited(other, id), 'slightly late');
});

test('a file the feed added and then removed is not expected in the listing', async () => {
  const { f, other } = await lagging(), protocol = new DatasetProtocol(f.provider, new DatasetTestJournal()), { plan, descriptor } = f.sync.binding;
  const shard = await datasetShard('card', f.card.id);
  // Two consolidations in one range of the feed: the first checkpoint is both added and removed, as the fixture replays events one by one.
  await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, await protocol.captureShard(plan, shard)));
  await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, await protocol.captureShard(plan, shard)));
  await other.sync.sync({ force: true });
  assert.equal(edited(other, f.card.id), 'edited');
});

test('an unfinished feed does not expect a file a later page could still remove', async () => {
  const { f, other } = await lagging(), protocol = new DatasetProtocol(f.provider, new DatasetTestJournal()), { plan, descriptor } = f.sync.binding;
  const shard = await datasetShard('card', f.card.id), before = f.provider.events.length;
  await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, await protocol.captureShard(plan, shard)));
  await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, await protocol.captureShard(plan, shard)));
  // Pushes the removal past what one pass reads, so this pass sees the checkpoint added and nothing about its removal.
  const removal = f.provider.events.findLastIndex(event => event.removed);
  const firstRemoval = f.provider.events.findIndex((event, at) => at >= before && event.removed && f.provider.events.slice(before, at).some(earlier => earlier.id === event.id && !earlier.removed));
  assert.ok(firstRemoval >= before && removal >= firstRemoval);
  f.provider.events.splice(firstRemoval, 0, ...Array.from({ length: DATASET_LIMITS.feedEvents }, (_, at) => ({ id: `noise-${at}`, removed: true })));
  await other.sync.sync({ force: true });
  await other.sync.sync({ force: true });
  assert.equal(edited(other, f.card.id), 'edited');
});

test('a host with all its transfers open makes a pass retry, not ask for attention', async () => {
  const f = await steady(); let once = true;
  f.provider.hook = async method => { if (method === 'read' && once) { once = false; throw Object.assign(new Error('busy'), { code: 'transfer-busy' }); } };
  await edit(f);
  await assert.rejects(f.sync.sync(), { code: 'transfer-busy' });
  assert.equal(f.sync.status.phase, 'backoff');
});

test('one request reserves every ID of an operation', async () => {
  for (const [name, change] of [['new note', create], ['edit', edit], ['note with an attachment', attach], ['group rename', rename]]) {
    const f = await steady();
    await change(f); await f.sync.sync();
    assert.equal(f.calls.filter(call => call.method === 'allocateFileIds').length, 1, name);
    assert.equal(f.calls.filter(call => call.method === 'allocateFileId').length, 0, name);
  }
});

test('an ID allocated for this attempt is not looked up before it is created', async () => {
  for (const [name, change] of [['new note', create], ['edit', edit], ['note with an attachment', attach]]) {
    const f = await steady();
    await change(f); await f.sync.sync();
    const writes = indexes(f, isWrite);
    assert.ok(writes.length >= 2, name);
    for (const at of writes) {
      const { id } = f.calls[at].args[0].file;
      assert.ok(!f.calls.slice(0, at).some(call => (call.args[0]?.id ?? call.args[0]?.file?.id) === id), `${name}: ${id} was looked up first`);
    }
  }
});

test('a job left by an earlier attempt looks before it creates, because that attempt may have reached Drive', async () => {
  const f = await steady(); let once = true;
  f.provider.hook = async (point, id) => {
    const write = f.calls.findLast(call => call.method === 'createObject' && call.args[0].file.id === id);
    if (point === 'create-before' && once && write?.args[0].file.kind === 'change') {
      once = false; throw Object.assign(new Error('down'), { code: 'service-unavailable' });
    }
  };
  await edit(f);
  await assert.rejects(f.sync.sync(), { code: 'service-unavailable' });
  const body = f.calls.find(call => call.method === 'createObject' && call.args[0].file.kind === 'revision').args[0].file.id;
  f.calls.length = 0; await f.sync.sync({ force: true });
  assert.equal(f.workspace.pendingCount, 0);
  assert.ok(f.calls.some(call => call.method === 'readObject' && call.args[0].file.id === body), 'it looks first');
  assert.ok(!f.calls.some(call => call.method === 'createObject' && call.args[0].file.id === body), 'and does not upload the body twice');
});

const consolidate = async f => {
  let card = f.card;
  for (let i = 0; i < DATASET_LIMITS.tailSoft; i++) card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  return card;
};
const currentChanges = f => [...f.provider.files.values()].filter(item => item.file.kind === 'change').length;

test('retirement deletes its inputs in one batch', async () => {
  const f = await steady(); await consolidate(f);
  while (f.workspace.pendingCount) await f.sync.sync({ force: true });
  const batches = f.calls.filter(call => call.method === 'deleteFiles');
  assert.equal(batches.length, 1); assert.ok(batches[0].args[0].ids.length > 1);
  assert.equal(f.calls.filter(call => call.method === 'deleteFile').length, 0);
});

test('a batch part that fails keeps the retirement owed, and the next pass finishes it', async () => {
  const f = await steady(); await consolidate(f);
  const deleteFiles = f.provider.deleteFiles.bind(f.provider); let once = true;
  f.provider.deleteFiles = async input => {
    if (!once) return deleteFiles(input);
    once = false; const [first, ...rest] = input.ids;
    return [{ id: first, code: 'rate-limit' }, ...await deleteFiles({ ...input, ids: rest })];
  };
  let failure = null;
  while (f.workspace.pendingCount && !failure) { try { await f.sync.sync({ force: true }); } catch (error) { failure = error; } }
  assert.equal(failure?.code, 'rate-limit');
  while (f.workspace.pendingCount) await f.sync.sync({ force: true });
  assert.ok(currentChanges(f) < DATASET_LIMITS.tailSoft, 'the inputs are gone');
});

test('a batch that fails outright is reported, and does not turn into one request per file', async () => {
  const f = await steady(); await consolidate(f);
  f.provider.deleteFiles = async () => { throw Object.assign(new Error('slow down'), { code: 'rate-limit' }); };
  let failure = null;
  while (f.workspace.pendingCount && !failure) { try { await f.sync.sync({ force: true }); } catch (error) { failure = error; } }
  assert.equal(failure?.code, 'rate-limit');
  assert.ok(!f.calls.some(call => call.method === 'deleteFile'));
});

test('retirement checks every input before it deletes any of them', async () => {
  const f = await steady(); let card = f.card;
  for (let i = 0; i < 4; i++) { card = await f.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision); await f.sync.sync(); }
  const protocol = new DatasetProtocol(f.provider, new DatasetTestJournal()), { descriptor } = f.sync.binding;
  const shard = await datasetShard('card', f.card.id);
  const inputs = await protocol.captureShard(f.plan, shard);
  const changes = inputs.filter(input => input.file.kind === 'change');
  assert.ok(changes.length > 1);
  const successor = await protocol.checkpoint(f.plan, shard, inputs);
  const last = changes.at(-1).file.id, stored = f.provider.files.get(last);
  f.provider.files.set(last, { ...stored, file: { ...stored.file, sha256: 'a'.repeat(64) } });
  const before = currentChanges(f);
  await assert.rejects(protocol.retire(descriptor, f.plan, successor), { code: 'invalid-dataset' });
  assert.equal(currentChanges(f), before, 'nothing was deleted');
});

test('a capture marks a purged note even when memory still holds its body', async () => {
  const f = await steady(), shard = await datasetShard('card', f.card.id);
  await edit(f); await f.sync.sync();
  const records = new VerifiedRecords(), protocol = new DatasetProtocol(f.provider, new DatasetTestJournal(), { records });
  await protocol.captureShard(f.plan, shard);
  const parent = f.plan.folders.buckets[shard]; await ensureDatasetDirectory(f.provider, f.plan, parent);
  await protocol.publish('purge', parent, datasetRecord(f.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: f.card.id,
    folderIds: [], trashEpisode: crypto.randomUUID(), heads: [f.card.revision] }));
  const reads = f.provider.stats.historyReads;
  const change = (await protocol.captureShard(f.plan, shard, undefined, { reuse: true })).find(input => input.file.kind === 'change' && input.file.entityId === f.card.id);
  assert.ok(change.purge, 'the purge listing decides');
  assert.equal(change.head, undefined, 'memory does not bring the body back');
  assert.equal(f.provider.stats.historyReads, reads);
});

test('retiring more than a batch holds takes several batches', async () => {
  const f = await steady(), protocol = new DatasetProtocol(f.provider, new DatasetTestJournal()), { descriptor } = f.sync.binding;
  const shard = await datasetShard('card', f.card.id), parent = f.plan.folders.shards[shard];
  const [first] = await protocol.captureShard(f.plan, shard);
  // Late duplicates of one receipt are legal, and they reach more inputs than one batch without any consolidation stepping in.
  for (let i = 0; i < 110; i++) await protocol.publish(`duplicate-${i}`, parent, first.value);
  const sizes = [], deleteFiles = f.provider.deleteFiles.bind(f.provider);
  f.provider.deleteFiles = input => { sizes.push(input.ids.length); return deleteFiles(input); };
  const inputs = await protocol.captureShard(f.plan, shard);
  assert.ok(inputs.length > 100);
  assert.equal(await protocol.retire(descriptor, f.plan, await protocol.checkpoint(f.plan, shard, inputs)), true);
  assert.deepEqual(sizes, [100, inputs.length - 100]);
});

test('an operation needing more IDs than one request gives asks again', async () => {
  const f = await steady(), attachments = [];
  for (let i = 0; i < 120; i++) {
    const bytes = new TextEncoder().encode(`attached ${i}`), id = await sha256(bytes);
    await f.storage.putAttachmentBytes('google:test', id, bytes);
    attachments.push({ id, size: bytes.length, name: `${i}.txt`, mediaType: 'text/plain' });
  }
  await f.workspace.createCard({ ...content('many files'), attachments });
  await f.sync.sync();
  assert.equal(f.workspace.pendingCount, 0);
  assert.deepEqual(f.calls.filter(call => call.method === 'allocateFileIds').map(call => call.args[0]), [100, 23]);
});

test('an unreadable batch reply falls back to deleting one by one', async () => {
  const f = await steady(); await consolidate(f);
  f.provider.deleteFiles = async () => { throw Object.assign(new Error('garbled'), { code: 'invalid-source-response' }); };
  while (f.workspace.pendingCount) await f.sync.sync({ force: true });
  assert.ok(f.calls.some(call => call.method === 'deleteFile'));
  assert.ok(currentChanges(f) < DATASET_LIMITS.tailSoft);
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
      // Next come the receipt's read-back, a note's purge listing and the five requests of a proof.
      const closing = f.calls.slice(at + 1, at + 8), { entityId } = f.calls[at].args[0].file;
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
