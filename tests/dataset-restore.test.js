import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetHistory } from '../src/sources/dataset-history.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetReset } from '../src/sources/dataset-reset.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { saveSafetyBackup } from '../src/backup/restore.js';
import { prepareDatasetRestore, resumeDatasetRestore } from '../src/backup/dataset-restore.js';

const area = { x: 0, y: 0, width: 1200, height: 900 }, content = text => ({ text, format: 'markdown', attachments: [] });
async function client(provider = null, records = new MemoryRecordStore()) {
  const profileId = provider ? 'google:test' : 'local', storage = new WorkspaceRecordStorage(records, profileId);
  const state = await storage.load(profileId), persist = (...args) => storage.save(...args);
  const workspace = state ? new Workspace(state, persist) : await Workspace.create({ profileId, deviceId: 'device', current: true,
    area, bootstrapGroup: !provider, persist });
  const history = new DatasetHistory({ workspace, storage, fileStore: provider }); workspace.setHistory(history);
  storage.setAttachmentLoader(id => history.attachment(id));
  return { workspace, storage, records, fileStore: provider, sync: provider ? new DatasetSync({ workspace, storage, fileStore: provider }) : null };
}
async function backup(versions = 8) {
  const source = await client(); let card = await source.workspace.createCard(content('initial'));
  for (let i = 0; i < versions; i++) card = await source.workspace.updateCard(card.id, { content: content(`restored ${i}`) }, card.revision);
  return openBackup((await createBackup(source)).bytes);
}
async function stage(provider, document) {
  const target = await client(provider); await target.sync.sync();
  await target.workspace.createCard(content('old current')); await target.sync.sync(); await target.sync.stop({ endSession: false });
  const plan = await prepareDatasetRestore({ ...target, document, workAreas: [area], layout: 'backup' });
  const safety = await saveSafetyBackup({ ...target, save: async () => ({ saved: true, receipt: 'verified' }) });
  const state = await plan.stage(target.workspace, target.storage, provider, safety);
  return { ...target, state, plan };
}

test('seeded cloud replacement publishes history before ready and exposes a fixed current checkpoint set', async () => {
  const provider = new DatasetTestProvider(), document = await backup(145), target = await stage(provider, document);
  assert.equal(target.state.format, 'work-fleet-workspace-current'); assert.equal(target.state.revisions.length, 2);
  let seeded = null;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'ready') {
      seeded = provider.files.get(id).file.datasetId;
      assert.equal([...provider.files.values()].filter(item => item.file.datasetId === seeded && item.file.kind === 'revision').length, 147);
      assert.equal([...provider.files.values()].filter(item => item.file.datasetId === seeded && item.file.kind === 'change').length, 0);
    }
  };
  const state = await resumeDatasetRestore({ ...target, state: target.state });
  assert.equal(state.cloudRestore, undefined); assert.equal(state.sync.pendingCount, 0); assert.equal(state.cards[0].content.text, 'restored 144');
  assert.notEqual(state.cards[0].id, document.data.local.cards[0].id);
  const reset = new DatasetReset(provider, target.storage); assert.equal((await reset.status()).ready, true);
  assert.equal((await reset.status()).phase, 'cleanup', 'old content cleanup remains a background task');
  provider.forbiddenHistory = true;
  const follower = await client(provider); await follower.sync.sync(); assert.equal(follower.workspace.snapshot.cards[0].content.text, 'restored 144');
  assert.equal([...provider.files.values()].filter(item => item.file.datasetId === seeded && item.file.kind === 'checkpoint').length, 17);
});

test('an interrupted seed resumes its outbox and never publishes an empty ready marker or duplicate history', async () => {
  const provider = new DatasetTestProvider(), document = await backup(10), target = await stage(provider, document);
  let bodies = 0, failed = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'revision' && ++bodies === 5 && !failed) {
      failed = true; throw Object.assign(new Error('disconnected'), { code: 'service-unavailable' });
    }
  };
  await assert.rejects(resumeDatasetRestore({ ...target, state: target.state }), { code: 'service-unavailable' });
  const job = await target.storage.getJob('dataset-reset'), initializer = await target.storage.getJob(`dataset-reset-initialize:${job.operationId}`);
  assert.equal(provider.files.has(initializer.binding.plan.readyId), false);
  provider.hook = async () => {};
  const reopened = await client(provider, target.records);
  const state = await resumeDatasetRestore({ ...reopened, state: reopened.workspace.state });
  const bodiesAfter = [...provider.files.values()].filter(item => item.file.datasetId === state.sync.dataset.plan.datasetId && item.file.kind === 'revision');
  assert.equal(bodiesAfter.length, 12); assert.equal(new Set(bodiesAfter.map(item => item.file.revisionId)).size, 12);
  assert.equal(state.cards[0].content.text, 'restored 9'); assert.equal(state.cloudRestore, undefined);
});

test('old-client deletion after seed acknowledgement stops restore without rebuilding the namespace', async () => {
  const provider = new DatasetTestProvider(), target = await stage(provider, await backup(3));
  let deleted = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'revision' && !deleted) {
      deleted = true; const files = [...provider.files.keys()]; provider.hook = async () => {};
      for (const file of files) await provider.deleteFile({ id: file });
      throw Object.assign(new Error('old reset finished'), { code: 'service-unavailable' });
    }
  };
  await assert.rejects(resumeDatasetRestore({ ...target, state: target.state }));
  const before = provider.stats.creates, reopened = await client(provider, target.records);
  await assert.rejects(resumeDatasetRestore({ ...reopened, state: reopened.workspace.state }), { code: 'source-reset-superseded' });
  assert.equal(provider.stats.creates, before); assert.equal(reopened.workspace.snapshot.cards[0].content.text, 'restored 2');
});

test('new-identity cloud restore preserves this device layout when the backup layout is not selected', async () => {
  const provider = new DatasetTestProvider(), target = await client(provider); await target.sync.sync();
  const card = await target.workspace.createCard(content('same account'));
  await target.workspace.layout.placeNew(target.workspace.snapshot, [area]);
  await target.workspace.layout.configure({ quickMove: true }, target.workspace.snapshot); await target.sync.sync();
  const document = await openBackup((await createBackup(target)).bytes);
  await target.sync.stop({ endSession: false });
  const before = target.workspace.state.layout;
  const plan = await prepareDatasetRestore({ ...target, document, workAreas: [area], layout: 'preserve' });
  const safety = await saveSafetyBackup({ ...target, save: async () => ({ saved: true, receipt: 'verified' }) });
  const next = await plan.stage(target.workspace, target.storage, provider, safety);
  assert.equal(next.layout.quickMove, true); assert.notEqual(next.cards[0].id, card.id);
  assert.deepEqual(next.layout.placements[next.cards[0].id], before.placements[card.id]);
  assert.ok(next.layout.grid.slots.includes(next.groups[0].id));
});

test('lost final seed acknowledgement is recovered without uploading the captured history again', async () => {
  const provider = new DatasetTestProvider(), target = await stage(provider, await backup(2));
  const commit = target.records.commit.bind(target.records); let failed = false;
  target.records.commit = async (...args) => {
    const receipt = await commit(...args);
    if (!failed && args[0].puts.some(row => row.key.startsWith('seed-progress:') && row.value.complete)) {
      failed = true; throw new Error('lost local acknowledgement');
    }
    return receipt;
  };
  await assert.rejects(resumeDatasetRestore({ ...target, state: target.state }));
  target.records.commit = commit;
  const initial = await target.storage.getJob('dataset-reset'), plan = await target.storage.getJob(`dataset-reset-initialize:${initial.operationId}`);
  const count = [...provider.files.values()].filter(item => item.file.datasetId === plan.binding.plan.datasetId && item.file.kind === 'revision').length;
  const reopened = await client(provider, target.records), next = await resumeDatasetRestore({ ...reopened, state: reopened.workspace.state });
  assert.equal(next.cards[0].content.text, 'restored 1');
  assert.equal([...provider.files.values()].filter(item => item.file.datasetId === plan.binding.plan.datasetId && item.file.kind === 'revision').length, count);
});

test('edits after the captured restore boundary remain queued and sync after seeded readiness', async () => {
  const provider = new DatasetTestProvider(), target = await stage(provider, await backup(4));
  const editing = new Workspace(target.state, (...args) => target.storage.save(...args));
  const card = editing.snapshot.cards[0];
  await editing.updateCard(card.id, { content: content('edited after staging') }, card.revision);
  const next = await resumeDatasetRestore({ ...target, state: editing.state });
  assert.equal(next.cards[0].content.text, 'edited after staging'); assert.equal(next.sync.pendingCount, 0);
  assert.equal(next.conflicts.length, 0);
  const bodies = [...provider.files.values()].filter(item => item.file.datasetId === next.sync.dataset.plan.datasetId && item.file.kind === 'revision');
  assert.equal(bodies.length, 7);
  const follower = await client(provider); await follower.sync.sync();
  assert.equal(follower.workspace.snapshot.cards[0].content.text, 'edited after staging');
});
