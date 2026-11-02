import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetHistory } from '../src/sources/dataset-history.js';
import { DatasetPurge } from '../src/sources/dataset-purge.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetReset } from '../src/sources/dataset-reset.js';
import { previewDatasetRejoin, stageDatasetRejoin, resumeDatasetReset, cleanupDatasetTransition } from '../src/sources/dataset-transition.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';

const content = text => ({ text, format: 'markdown', attachments: [] });
async function client(provider, records = new MemoryRecordStore()) {
  const storage = new WorkspaceRecordStorage(records, 'google:test'), saved = await storage.load('google:test');
  const persist = (...args) => storage.save(...args);
  const workspace = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId: 'google:test', deviceId: 'device',
    area: { x: 0, y: 0, width: 1200, height: 900 }, current: true, bootstrapGroup: false, persist });
  workspace.setHistory(new DatasetHistory({ workspace, storage, fileStore: provider }));
  return { workspace, storage, records, fileStore: provider, sync: new DatasetSync({ workspace, storage, fileStore: provider }) };
}

test('confirmed reset switches local generation once, becomes usable before old history cleanup and resumes', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('old'));
  for (let i = 0; i < 80; i++) card = await a.workspace.updateCard(card.id, { content: content(`old ${i}`) }, card.revision);
  while (a.workspace.pendingCount) await a.sync.sync();
  await a.sync.stop({ endSession: false });
  const reset = new DatasetReset(provider, a.storage), preview = await reset.preview();
  const oldDataset = a.workspace.syncState.dataset.plan.datasetId, read = provider.readObject.bind(provider);
  provider.readObject = async args => {
    assert.ok(args.file.kind !== 'revision' || args.file.datasetId !== oldDataset, 'reset downloaded old history'); return read(args);
  };
  const state = await resumeDatasetReset({ ...a, state: a.workspace.state, preview });
  assert.equal(state.cards.length, 0); assert.equal(state.groups.length, 1);
  assert.equal((await reset.status()).phase, 'cleanup');
  const reopened = await client(provider, a.records), fresh = await reopened.workspace.createCard(content('new after readiness'));
  const again = await resumeDatasetReset({ ...reopened, state: reopened.workspace.state });
  assert.equal(again.cards[0].id, fresh.id, 'resume erased post-reset work');
  const follower = await client(provider); await follower.sync.sync(); assert.equal(follower.workspace.snapshot.cards[0].id, fresh.id);
});

test('interruption after recording a reset does not resume the old writer or choose another reset generation', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  await a.workspace.createCard(content('discarded only by confirmed reset')); await a.sync.stop({ endSession: false });
  const reset = new DatasetReset(provider, a.storage), preview = await reset.preview();
  provider.hook = async point => { if (point === 'create-before') throw Object.assign(new Error('offline'), { code: 'service-unavailable' }); };
  await assert.rejects(resumeDatasetReset({ ...a, state: a.workspace.state, preview }), { code: 'service-unavailable' });
  const job = await reset.status(), saved = await a.storage.load('google:test');
  assert.equal(saved.sync.resetOperation, job.operationId); assert.equal(saved.cards.length, 0);
  provider.hook = async () => {};
  const b = await client(provider, a.records);
  const result = await resumeDatasetReset({ ...b, state: b.workspace.state });
  assert.equal(result.sync.resetOperation, job.operationId); assert.equal((await reset.status()).operationId, job.operationId);
});

test('rejoin requires a ready generation and an unchanged preview, and never uploads discarded local identities', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const old = await a.workspace.createCard(content('unsynced local work'));
  const b = await client(provider); await b.sync.sync(); await b.sync.stop({ endSession: false });
  const reset = new DatasetReset(provider, b.storage);
  await resumeDatasetReset({ ...b, state: b.workspace.state, preview: await reset.preview() });
  const preview = await previewDatasetRejoin(a); assert.equal(preview.pending, 1);
  const draft = a.workspace.blankDraft(old.groupId, old); draft.content.text = 'newer'; await a.workspace.saveDraft(draft);
  await assert.rejects(stageDatasetRejoin({ ...a, preview }), { code: 'stale-restore-plan' });
  await a.sync.stop({ endSession: false });
  await stageDatasetRejoin({ ...a, preview: await previewDatasetRejoin(a) });
  const reopened = await client(provider, a.records); await reopened.sync.sync();
  assert.equal(reopened.workspace.pendingCount, 0); assert.equal(reopened.workspace.snapshot.cards.length, 0);
  assert.equal([...provider.files.values()].some(item => item.file.entityId === old.id), false);
  await provider.deleteFile({ id: reopened.workspace.syncState.dataset.plan.rootId });
  await assert.rejects(previewDatasetRejoin(reopened));
});

test('a verified rejoin retires abandoned local cleanup journals without deleting the newly joined cloud', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const oldBinding = a.workspace.syncState.dataset;
  await a.storage.putJob('purge-work:old', { kind: 'dataset-purge', profileId: 'google:test', phase: 'committed',
    binding: oldBinding, item: { entityId: 'old', operationId: 'old' } });
  await a.storage.putJob('dataset-reset', { operationId: 'abandoned', phase: 'capture' });
  await a.storage.putJob('reset-page:abandoned:1', { kind: 'reset-page:abandoned', files: [{ id: 'do-not-delete' }] });
  const b = await client(provider); await b.sync.sync(); await b.sync.stop({ endSession: false });
  const reset = new DatasetReset(provider, b.storage);
  await resumeDatasetReset({ ...b, state: b.workspace.state, preview: await reset.preview() });
  await a.sync.stop({ endSession: false });
  await stageDatasetRejoin({ ...a, preview: await previewDatasetRejoin(a) });
  const reopened = await client(provider, a.records), before = provider.stats.deletes;
  assert.equal((await new DatasetPurge(reopened).step()).phase, 'retired');
  while (await cleanupDatasetTransition(reopened.storage)) { /* Bounded local journal pages only. */ }
  assert.equal(await reopened.storage.getJob('reset-page:abandoned:1'), null);
  assert.equal(provider.stats.deletes, before); await reopened.sync.sync();
});
