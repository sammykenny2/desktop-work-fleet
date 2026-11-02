import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetHistory } from '../src/sources/dataset-history.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetPurge } from '../src/sources/dataset-purge.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { DATASET_SHARDS, datasetRecord, datasetShard } from '../src/sources/dataset-codec.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { createSourceBackup } from '../src/backup/export.js';
import { prepareRestore, prepareLocalRestore } from '../src/backup/restore.js';
import { captureDataset } from '../src/backup/dataset-capture.js';
import { sha256 } from '../src/sources/files.js';
import { AutomaticBackup } from '../src/backup/automatic.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ text, format: 'markdown', attachments: [] });
async function client(provider = null, records = new MemoryRecordStore()) {
  const profileId = provider ? 'google:test' : 'local', storage = new WorkspaceRecordStorage(records, profileId);
  const saved = await storage.load(profileId), persist = (...args) => storage.save(...args);
  const workspace = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId, deviceId: 'device', area,
    current: true, bootstrapGroup: !provider, persist });
  let online = provider;
  const history = new DatasetHistory({ workspace, storage, fileStore: () => online }); workspace.setHistory(history);
  storage.setAttachmentLoader(id => history.attachment(id));
  return { workspace, storage, records, history, setOnline: value => { online = value; },
    sync: provider ? new DatasetSync({ workspace, storage, fileStore: provider }) : null,
    purge: new DatasetPurge({ workspace, storage, fileStore: provider }) };
}
const apply = (c, plan) => c.workspace.applyRestore(plan, { persist: (...args) => c.storage.saveWithAttachments(...args) });
async function purge(c, id) {
  const card = c.workspace.snapshot.cards.find(card => card.id === id);
  if (!card.deleted) await c.workspace.updateCard(id, { deleted: true }, card.revision);
  await c.purge.enqueue(await c.purge.preview([id]));
  for (let i = 0; i < 1000; i++) if (!await c.purge.step()) return;
  throw new Error('purge stalled');
}

test('current-format backups declare complete or current-only coverage and restore unknown ancestry with full local history', async () => {
  const a = await client(); let card = await a.workspace.createCard(content('old'));
  for (let i = 0; i < 5; i++) card = await a.workspace.updateCard(card.id, { content: content(`version ${i}`) }, card.revision);
  const draft = a.workspace.blankDraft(card.groupId, card); draft.content.text = 'unsaved'; await a.workspace.saveDraft(draft);
  const full = await createBackup(a), current = await createBackup({ ...a, coverage: 'current-state-only' });
  assert.equal(full.manifest.coverage.mode, 'complete-retained-history'); assert.equal(full.manifest.counts.revisions, 7);
  assert.equal(current.manifest.counts.revisions, 2); assert.equal(current.manifest.counts.pendingRevisions, 0);
  const partial = await openBackup(current.bytes, { requireCurrent: true });
  assert.equal(partial.data.drafts[0].baseContent.text, 'version 4');
  const b = await client(), plan = await prepareRestore({ workspace: b.workspace, document: await openBackup(full.bytes),
    mode: 'import', workAreas: [area] });
  await apply(b, plan); assert.equal(b.workspace.state.revisions.length, 3);
  const restored = b.workspace.snapshot.cards[0]; assert.notEqual(restored.id, card.id);
  assert.equal((await b.storage.page('card', restored.id)).records.length, 6);
  assert.equal(Object.values(b.workspace.state.drafts)[0].content.text, 'unsaved');
  const c = await client(), replace = await prepareLocalRestore({ workspace: c.workspace, document: partial, workAreas: [area] });
  await apply(c, replace); assert.equal(c.workspace.state.revisions.length, 2); assert.equal(c.workspace.snapshot.cards[0].content.text, 'version 4');
  assert.equal((await client(null, c.records)).workspace.snapshot.cards[0].content.text, 'version 4');
});

test('cold Google backups fetch retained history and old attachments; offline fallback is explicitly current-only', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const bytes = new TextEncoder().encode('old attachment'), id = await sha256(bytes); await a.storage.putAttachmentBytes('google:test', id, bytes);
  let card = await a.workspace.createCard({ ...content('old'), attachments: [{ id, name: 'old.txt', size: bytes.length }] });
  await a.sync.sync(); card = await a.workspace.updateCard(card.id, { content: content('current') }, card.revision); await a.sync.sync();
  const protocol = new DatasetProtocol(provider, a.storage), binding = a.sync.binding;
  for (const shard of DATASET_SHARDS) {
    const inputs = await protocol.captureShard(binding.plan, shard);
    if (inputs.some(item => item.file.kind === 'change')) await protocol.retire(binding.descriptor, binding.plan, await protocol.checkpoint(binding.plan, shard, inputs));
  }
  const b = await client(provider); await b.sync.sync(); assert.equal((await b.storage.page('card', card.id)).records.length, 1);
  const backup = await createBackup(b), opened = await openBackup(backup.bytes, { requireCurrent: true });
  assert.equal(opened.manifest.counts.revisions, 3); assert.equal(opened.manifest.counts.attachments, 1); assert.deepEqual(opened.attachment(id), bytes);
  b.setOnline(null);
  await assert.rejects(createBackup(b), { code: 'history-offline' });
  const partial = await createSourceBackup({ ...b, source: { sync: async () => { throw new Error('offline'); } }, confirmKnownData: async () => true });
  assert.equal(partial.knownDataOnly, true); assert.equal(partial.manifest.coverage.mode, 'current-state-only');
  assert.equal(partial.manifest.counts.revisions, 2); assert.equal(partial.manifest.counts.attachments, 0);
});

test('a purge during history hydration aborts export instead of returning a valid-looking partial backup', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const card = await a.workspace.createCard(content('published')); await a.sync.sync();
  let triggered = false;
  provider.hook = async (point, id) => {
    if (point !== 'read' || provider.files.get(id)?.file.entityId !== card.id || triggered) return;
    triggered = true; const binding = a.sync.binding;
    const marker = datasetRecord(binding.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: card.id,
      folderIds: [], trashEpisode: crypto.randomUUID(), heads: [card.revision] });
    await new DatasetProtocol(provider, a.storage).publish('test-purge', binding.plan.folders.buckets[await datasetShard('card', card.id)], marker);
  };
  await assert.rejects(createBackup(a), { code: 'dataset-purged' }); assert.equal(triggered, true);
});

test('history entry preflight rejects an oversized complete backup before any uncached revision GET', async () => {
  const a = await client(), card = await a.workspace.createCard(content('one')); let reads = 0;
  const workspace = { state: a.workspace.state, verifyHistorySnapshot: async () => {},
    historyPage: async (kind, entityId, { after }) => {
      if (kind === 'group') return { records: [], next: null, coverage: 'complete' };
      const start = after ?? 0, entries = Array.from({ length: 50 }, (_, i) => ({ kind, entityId, revisionId: `r-${start + i}`,
        file: { id: `f-${start + i}`, size: 200 } }));
      return { records: [], entries, next: start + 50 < 20000 ? start + 50 : null, coverage: 'complete' };
    }, historicalRevision: async () => { reads++; throw new Error('must preflight first'); } };
  await assert.rejects(captureDataset({ workspace, state: workspace.state, coverage: 'complete-retained-history' }), { code: 'backup-limit' });
  assert.equal(reads, 0); assert.ok(card);
});

test('merge recovers a purged backup note under a new identity and a purge after preview invalidates the plan', async () => {
  const a = await client(), original = await a.workspace.createCard(content('recover me'));
  const document = await openBackup((await createBackup(a)).bytes);
  const stale = await prepareRestore({ workspace: a.workspace, document, mode: 'merge', workAreas: [area] });
  await purge(a, original.id);
  await assert.rejects(apply(a, stale), { code: 'stale-restore-plan' });
  const plan = await prepareRestore({ workspace: a.workspace, document, mode: 'merge', workAreas: [area] });
  assert.equal(plan.preview.recoveredAsNew, 1); await apply(a, plan);
  const recovered = a.workspace.snapshot.cards[0]; assert.notEqual(recovered.id, original.id); assert.equal(recovered.content.text, 'recover me');
  assert.equal(await a.storage.get(original.revision), null); assert.ok(await a.storage.getControl(`local-purge:${original.id}`));
});

test('current restore refuses an old-format archive without modifying either workspace or archive', async () => {
  const legacy = await Workspace.create({ profileId: 'old', deviceId: 'old', area, persist: async () => {} });
  const archive = await createBackup({ workspace: legacy, storage: {} }), original = archive.bytes.slice(), a = await client();
  await assert.rejects(openBackup(archive.bytes, { requireCurrent: true }), { code: 'unsupported-backup-schema' });
  const document = await openBackup(archive.bytes), before = a.workspace.state;
  await assert.rejects(prepareRestore({ workspace: a.workspace, document, workAreas: [area] }), { code: 'unsupported-backup-schema' });
  assert.deepEqual(a.workspace.state, before); assert.deepEqual(archive.bytes, original);
});

test('interrupted bulk local replacement keeps the active generation and existing bytes intact', async () => {
  const source = await client(); let note = await source.workspace.createCard(content('version'));
  for (let i = 0; i < 410; i++) note = await source.workspace.updateCard(note.id, { content: content(`history ${i}`) }, note.revision);
  const document = await openBackup((await createBackup(source)).bytes), target = await client();
  await target.workspace.createCard(content('keep until commit')); const before = target.workspace.state;
  const plan = await prepareLocalRestore({ workspace: target.workspace, document, workAreas: [area] });
  const commit = target.records.commit.bind(target.records); let written = 0;
  target.records.commit = async (...args) => { if (++written === 3) throw new Error('disk full'); return commit(...args); };
  await assert.rejects(apply(target, plan), /disk full/); assert.deepEqual(target.workspace.state, before);
  target.records.commit = commit;
  const reopened = await client(null, target.records); assert.equal(reopened.workspace.snapshot.cards[0].content.text, 'keep until commit');
  await apply(reopened, await prepareLocalRestore({ workspace: reopened.workspace, document, workAreas: [area] }));
  assert.equal(reopened.workspace.snapshot.cards[0].content.text, 'history 409');
});

test('automatic complete backup failure keeps the last verified artifact and never silently exports a cache subset', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  await a.workspace.createCard(content('retained')); await a.sync.sync();
  let disk = null, removed = 0; const files = new Map();
  const service = new AutomaticBackup({ ...a, journal: { load: async () => disk,
    save: async (value, revision) => { assert.equal(disk?.revision ?? null, revision); disk = structuredClone(value); } },
  files: { canCreate: true, canPrune: true, read: async job => files.get(job.id) ?? null,
    create: async job => { files.set(job.id, job.bytes.slice()); return { saved: true, receipt: job.id }; },
    remove: async job => { removed++; files.delete(job.id); return { removed: true }; } } });
  await service.configure({ destinationId: 'chosen', destinationName: 'Test', encrypted: false, keep: 1 });
  await service.run({ force: true }); const good = disk.lastSuccess.id;
  a.setOnline(null); await assert.rejects(service.run({ force: true }), { code: 'history-offline' });
  assert.equal(disk.lastSuccess.id, good); assert.equal(disk.pending, null); assert.equal(files.size, 1); assert.equal(removed, 0);
  assert.equal((await openBackup(files.get(good))).manifest.coverage.mode, 'complete-retained-history');
});
