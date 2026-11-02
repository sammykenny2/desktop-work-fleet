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

test('baseline counts distinguish semantic provider calls from native HTTP requests', async () => {
  const f = await client();
  // The fixture opened another core session for metadata tests; warm a new synchronizer for this measurement.
  const sync = new DatasetSync({ workspace: f.workspace, storage: f.storage, fileStore: f.counted });
  await sync.sync(); f.calls.length = 0; await sync.sync();
  assert.equal(f.calls.length, 37);
  assert.equal(f.calls.filter(call => call.method === 'listDatasetChanges').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'readObject').length, 10);
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
