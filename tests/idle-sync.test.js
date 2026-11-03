import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });
const completedAt = '2026-11-03T01:00:00.000Z';
async function client({ note = false } = {}) {
  const records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'google:test');
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId: 'test', area, current: true,
    bootstrapGroup: false, persist: (...args) => storage.save(...args) });
  const provider = new DatasetTestProvider(), calls = [];
  const counted = new Proxy(provider, { get(target, key) {
    const value = Reflect.get(target, key, target);
    return typeof value !== 'function' ? value : (...args) => { calls.push({ method: key, args }); return value.apply(target, args); };
  } });
  const sync = new DatasetSync({ workspace, storage, fileStore: counted });
  await sync.sync();
  if (note) { await workspace.createCard(content('saved remote note')); await sync.sync(); }
  calls.length = 0;
  const session = await workspace.beginSync(counted.sourceId);
  const finish = (expected = workspace.syncState, cursor = 'next-empty') => workspace.completeEmptySync(session, expected, cursor, completedAt);
  return { records, storage, workspace, provider, counted, calls, sync, session, finish };
}

test('empty cursor commit persists only metadata and keeps concurrent unsaved text and existing layout', async () => {
  const f = await client({ note: true });
  // A never-saved note must survive a successful remote check without becoming an upload.
  const draft = f.workspace.blankDraft(f.workspace.snapshot.groups[0].id); draft.content = content('unsaved text');
  const expected = f.workspace.syncState;
  const saving = f.workspace.saveDraft(draft);
  await saving;
  const before = f.workspace.state, stats = f.records.stats;
  assert.equal(await f.finish(expected), true);
  assert.equal(f.records.stats.writes - stats.writes, 2);
  assert.equal(f.records.stats.reads - stats.reads, 0);
  const state = await new WorkspaceRecordStorage(f.records, 'google:test').load('google:test');
  assert.equal(state.sync.cursor, 'next-empty'); assert.equal(state.sync.lastSuccessfulSyncAt, completedAt);
  assert.deepEqual(state.drafts, before.drafts); assert.deepEqual(state.layout, before.layout);
  assert.deepEqual(state.revisions, before.revisions); assert.equal(state.sync.pendingCount ?? 0, 0);
  assert.equal(f.calls.length, 0);
});

test('empty checks cannot acknowledge new saves, replaced cursors or expired sessions', async () => {
  const f = await client(), expected = f.workspace.syncState;
  assert.equal(await f.finish({ ...expected, cursor: 'wrong' }), false);
  const before = f.records.stats.writes;
  assert.equal(await f.workspace.completeEmptySync(f.session, expected, 'next', completedAt, () => false), false);
  assert.equal(f.records.stats.writes, before);
  await f.workspace.createCard(content('queued while checking'));
  const pending = f.workspace.pendingCount;
  assert.equal(await f.finish(expected), false);
  assert.equal(f.workspace.syncState.cursor, expected.cursor); assert.equal(f.workspace.pendingCount, pending);
  await f.workspace.endSync(f.session);
  await assert.rejects(f.finish(), { code: 'stale-session' });
});

test('failed and competing-writer metadata commits preserve the previous cursor and unsaved content', async () => {
  const f = await client(), before = f.workspace.state;
  const commit = f.records.commit.bind(f.records);
  f.records.commit = async () => { throw new Error('disk full'); };
  await assert.rejects(f.finish(), /disk full/); assert.deepEqual(f.workspace.state, before);
  f.records.commit = commit;
  const other = new WorkspaceRecordStorage(f.records, 'google:test'); await other.load('google:test');
  await other.putJob('other-writer', { kind: 'test' });
  await assert.rejects(f.finish(), { code: 'stale-writer' }); assert.deepEqual(f.workspace.state, before);
  const reopened = await new WorkspaceRecordStorage(f.records, 'google:test').load('google:test');
  assert.equal(reopened.sync.cursor, before.sync.cursor);
});

test('ordinary unchanged checks replace the 37-call baseline with one feed read and two local rows', async () => {
  const f = await client();
  // The fixture opened another core session for metadata tests; warm a new synchronizer for this measurement.
  const sync = new DatasetSync({ workspace: f.workspace, storage: f.storage, fileStore: f.counted });
  await sync.sync();
  f.storage.getControl = () => assert.fail('empty checks cannot load shard bodies');
  f.provider.forbiddenHistory = true;
  for (const history of [0, 10_000, 1_000_000]) {
    f.provider.unrelatedHistory = history; f.calls.length = 0;
    const stats = f.records.stats;
    const result = await sync.sync({ onActivity: () => assert.fail('an automatic empty check is quiet') });
    assert.equal(result.unchanged, true);
    assert.deepEqual(f.calls.map(call => call.method), ['listDatasetChanges']);
    assert.equal(f.records.stats.reads - stats.reads, 0); assert.equal(f.records.stats.writes - stats.writes, 2);
  }
});

async function steady(options = {}) {
  const f = await client({ note: true });
  f.sync = new DatasetSync({ workspace: f.workspace, storage: f.storage, fileStore: f.counted, ...options });
  await f.sync.sync(); f.calls.length = 0; return f;
}

test('five-minute audits run once, fail closed and resume never treats a persisted cursor as runtime validation', async () => {
  let clock = 0;
  const f = await steady({ elapsed: () => clock, now: () => Date.parse(completedAt) + clock });
  for (let i = 1; i < 15; i++) { clock = i * 20_000; assert.equal((await f.sync.sync()).unchanged, true); }
  assert.equal(f.calls.length, 14);
  f.calls.length = 0; clock = 300_000; await f.sync.sync();
  assert.equal(f.calls.length, 6, 'one feed call plus the five requests of a generation check; this session already read its two records');
  f.calls.length = 0; await f.sync.sync(); assert.equal(f.calls.length, 1);
  const before = f.workspace.syncState;
  const root = f.sync.binding.plan.rootId;
  f.provider.hook = async (method, id) => { if (method === 'get' && id === root) throw Object.assign(new Error('removed root'), { code: 'file-missing' }); };
  clock = 600_000;
  await assert.rejects(f.sync.sync(), { code: 'dataset-changed' });
  assert.deepEqual(f.workspace.syncState, before);
  f.provider.hook = async () => {};
  await f.sync.sync(); f.calls.length = 0;
  clock += 600_000; f.sync.resume(); await f.sync.sync();
  assert.ok(f.calls.some(call => call.method === 'getObject'), 'long resume performs full validation');
});

test('nonempty and intermediate empty pages replay the committed cursor; invalid pages never advance it', async () => {
  const f = await steady();
  const list = f.provider.listDatasetChanges.bind(f.provider);
  for (const initial of [{ changes: [], nextCursor: 'intermediate' }, { changes: [{ id: 'unrelated', removed: true }], cursor: 'terminal' }]) {
    const cursor = f.workspace.syncState.cursor; let first = true; f.calls.length = 0;
    f.provider.listDatasetChanges = async args => { if (first) { first = false; return initial; } return list(args); };
    assert.notEqual((await f.sync.sync()).unchanged, true);
    assert.deepEqual(f.calls.filter(call => call.method === 'listDatasetChanges').map(call => call.args[0].cursor), [cursor, cursor]);
  }
  for (const page of [{ changes: [], cursor: '', nextCursor: 'x' }, { changes: null, cursor: 'x' }, { changes: [] }]) {
    const before = f.workspace.syncState;
    f.provider.listDatasetChanges = async () => page;
    await assert.rejects(f.sync.sync(), { code: 'invalid-dataset' });
    assert.deepEqual(f.workspace.syncState, before);
    f.provider.listDatasetChanges = list; await f.sync.sync();
  }
});

test('a save during the idle request is published through fresh guards instead of acknowledged by the empty page', async () => {
  const f = await steady(); let release, entered;
  const gate = new Promise(resolve => { entered = resolve; }); let once = true;
  f.provider.hook = async method => { if (once && method === 'changes') { once = false; entered(); await new Promise(resolve => { release = resolve; }); } };
  const check = f.sync.sync(); await gate;
  await f.workspace.createCard(content('saved during empty check'));
  release(); await check;
  assert.ok(f.calls.some(call => call.method === 'getObject'), 'a cached check must not authorize writes');
  assert.ok(f.calls.some(call => call.method === 'createObject'));
  assert.equal(f.workspace.pendingCount, 0);
  assert.ok(f.workspace.snapshot.cards.some(card => card.content.text === 'saved during empty check'));
});

test('account replacement and a purge queued during the request invalidate an empty result', async () => {
  for (const action of ['session', 'purge']) {
    const f = await steady(); let release, entered;
    const gate = new Promise(resolve => { entered = resolve; }); let once = true;
    f.provider.hook = async method => { if (once && method === 'changes') { once = false; entered(); await new Promise(resolve => { release = resolve; }); } };
    const check = f.sync.sync(); await gate;
    const before = f.workspace.syncState;
    if (action === 'session') await f.workspace.beginSync(f.counted.sourceId);
    else await f.storage.putJob('purge-queue:test', { kind: 'dataset-purge-queue', items: [] });
    release();
    if (action === 'session') {
      await assert.rejects(check, { code: 'stale-session' });
      assert.equal(f.workspace.syncState.cursor, before.cursor);
    } else {
      assert.notEqual((await check).unchanged, true);
      f.calls.length = 0; assert.notEqual((await f.sync.sync()).unchanged, true);
      assert.ok(f.calls.some(call => call.method === 'getObject'));
    }
  }
});

test('simultaneous triggers share a request and rejected cursors reconcile instead of jumping to now', async () => {
  const f = await steady();
  const first = f.sync.sync(); assert.equal(first, f.sync.sync()); await first;
  assert.equal(f.calls.length, 1); f.calls.length = 0;
  const list = f.provider.listDatasetChanges.bind(f.provider); let rejected = false;
  f.provider.listDatasetChanges = async args => {
    if (!rejected) { rejected = true; throw Object.assign(new Error('rejected cursor'), { code: 'cursor-expired' }); }
    return list(args);
  };
  assert.notEqual((await f.sync.sync()).unchanged, true);
  assert.equal(f.workspace.snapshot.cards[0].content.text, 'saved remote note');
});

test('legacy reset events and critical removals leave an idle cursor and unsaved text intact', async () => {
  for (const event of ['reset', 'removed']) {
    const f = await steady(), before = f.workspace.syncState;
    const draft = f.workspace.blankDraft(f.workspace.snapshot.groups[0].id); draft.content = content('unfinished work');
    await f.workspace.saveDraft(draft);
    if (event === 'reset') f.provider.events.push({ id: 'old-reset-fence', removed: false, legacyReset: true });
    else await f.provider.deleteFile({ id: f.sync.binding.plan.readyId });
    await assert.rejects(f.sync.sync(), { code: 'dataset-changed' });
    assert.equal(f.workspace.syncState.cursor, before.cursor);
    assert.equal(f.workspace.syncState.lastSuccessfulSyncAt, before.lastSuccessfulSyncAt);
    assert.equal(f.workspace.state.drafts[draft.id].content.text, 'unfinished work');
    assert.ok(!f.calls.some(call => ['createObject', 'createFolder', 'deleteFile'].includes(call.method)));
  }
});

test('a quiet failed check exposes backoff and preserves its last completed time', async () => {
  let now = Date.parse(completedAt);
  const f = await steady({ now: () => now, random: () => 0 }), before = f.workspace.syncState;
  f.provider.hook = async method => { if (method === 'changes') throw Object.assign(new Error('offline'), { code: 'network' }); };
  await assert.rejects(f.sync.sync(), { code: 'network' });
  assert.equal(f.sync.status.phase, 'backoff'); assert.deepEqual(f.workspace.syncState, before);
  await assert.rejects(f.sync.sync(), { code: 'sync-backoff' });
  assert.equal(f.calls.length, 1);
  f.provider.hook = async () => {}; now += 1000;
  assert.notEqual((await f.sync.sync()).unchanged, true, 'an error retires runtime eligibility');
});

test('a lost metadata commit acknowledgement is recovered by reload without inventing an empty view', async () => {
  const f = await client({ note: true }), before = f.workspace.state;
  const commit = f.records.commit.bind(f.records);
  f.records.commit = async (...args) => { await commit(...args); throw Object.assign(new Error('lost reply'), { code: 'native-outcome-unknown' }); };
  await assert.rejects(f.finish(), { code: 'native-outcome-unknown' });
  assert.deepEqual(f.workspace.state, before);
  f.records.commit = commit;
  await assert.rejects(f.finish(), { code: 'stale-writer' });
  const recovered = await new WorkspaceRecordStorage(f.records, 'google:test').load('google:test');
  assert.equal(recovered.sync.cursor, 'next-empty');
  assert.deepEqual(recovered.revisions, before.revisions);
});
