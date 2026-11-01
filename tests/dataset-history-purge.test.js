import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetHistory } from '../src/sources/dataset-history.js';
import { DatasetPurge } from '../src/sources/dataset-purge.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { DATASET_SHARDS } from '../src/sources/dataset-codec.js';
import { sha256 } from '../src/sources/files.js';
import { DatasetTestJournal, DatasetTestProvider } from './fixtures/dataset/provider.js';

const content = text => ({ text, format: 'markdown', attachments: [] });
async function client(provider = null, records = new MemoryRecordStore()) {
  const profileId = provider ? 'google:test' : 'local', storage = new WorkspaceRecordStorage(records, profileId);
  const saved = await storage.load(profileId), persist = (...args) => storage.save(...args);
  const workspace = saved ? new Workspace(saved, persist) : await Workspace.create({ profileId, deviceId: 'device',
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist, current: true, bootstrapGroup: !provider });
  const history = new DatasetHistory({ workspace, storage, fileStore: provider }); workspace.setHistory(history);
  storage.setAttachmentLoader(id => history.attachment(id));
  const sync = provider ? new DatasetSync({ workspace, storage, fileStore: provider }) : null;
  return { workspace, storage, records, history, sync, purge: new DatasetPurge({ workspace, storage, fileStore: provider }) };
}
async function finish(purge) {
  const phases = [];
  for (let i = 0; i < 500; i++) { const step = await purge.step(); if (!step) return phases; phases.push(step.phase); }
  assert.fail('cleanup did not finish within its bounded fixture');
}
async function consolidate(provider, binding) {
  const protocol = new DatasetProtocol(provider, new DatasetTestJournal());
  for (const shard of DATASET_SHARDS) {
    const inputs = await protocol.captureShard(binding.plan, shard);
    if (inputs.some(input => input.file.kind === 'change')) await protocol.retire(binding.descriptor, binding.plan, await protocol.checkpoint(binding.plan, shard, inputs));
  }
}

test('remote history pages use metadata and selected old versions fetch one body; attachments hydrate on demand', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const bytes = new TextEncoder().encode('lazy attachment'), id = await sha256(bytes);
  await a.storage.putAttachmentBytes('google:test', id, bytes);
  const old = await a.workspace.createCard({ ...content('old'), attachments: [{ id, name: 'file.txt', size: bytes.length }] });
  await a.sync.sync(); await a.workspace.updateCard(old.id, { content: content('current') }, old.revision); await a.sync.sync();
  await consolidate(provider, a.sync.binding);
  const b = await client(provider); await b.sync.sync();
  const cached = await b.workspace.historyPage('card', old.id);
  assert.equal(cached.records.length, 1); assert.equal(cached.coverage, 'cached');
  const reads = provider.stats.historyReads;
  const remote = await b.workspace.historyPage('card', old.id, { after: cached.next });
  assert.equal(remote.entries.length, 2); assert.equal(provider.stats.historyReads, reads);
  assert.equal((await b.workspace.historicalRevision(old.revision)).value.content.text, 'old');
  assert.equal(provider.stats.historyReads, reads + 1);
  assert.equal(await (await b.storage.getAttachment('google:test', id)).text(), 'lazy attachment');
});

test('permanent deletion sanitizes current checkpoints, cascades history and keeps neighboring notes', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let victim = await a.workspace.createCard(content('remove'));
  const neighbor = await a.workspace.createCard(content('keep'));
  for (let i = 0; i < 25; i++) victim = await a.workspace.updateCard(victim.id, { content: content(`old ${i}`) }, victim.revision);
  victim = await a.workspace.updateCard(victim.id, { deleted: true }, victim.revision);
  await a.sync.sync(); await consolidate(provider, a.sync.binding); await a.sync.sync();
  const preview = await a.purge.preview([victim.id]); await a.purge.enqueue(preview);
  provider.forbiddenHistory = true;
  const phases = await finish(a.purge);
  assert.ok(phases.includes('committed') && phases.includes('cloud-cleanup') && phases.includes('complete'));
  assert.equal(a.workspace.snapshot.cards.length, 1); assert.equal(a.workspace.snapshot.cards[0].id, neighbor.id);
  assert.equal([...provider.files.values()].filter(item => item.file.entityId === victim.id && item.file.kind !== 'purge').length, 0);
  assert.equal((await a.storage.page('card', victim.id)).records.length, 0);
  for (const key of Object.values(a.workspace.syncState.datasetView)) {
    assert.ok(!(await a.storage.getControl(key)).heads.some(head => head.record.entityId === victim.id), 'local current cache kept a deleted value');
  }
  assert.equal(await a.history.get(victim.revision), null);
  await assert.rejects(a.history.page('card', victim.id), { code: 'dataset-purged' });
  const b = await client(provider); await b.sync.sync(); assert.equal(b.workspace.snapshot.cards.length, 1);
});

test('Trash episodes reject stale previews and local deletion preserves shared attachment references', async () => {
  const a = await client();
  const bytes = new TextEncoder().encode('shared'), id = await sha256(bytes); await a.storage.putAttachmentBytes('local', id, bytes);
  const body = { ...content('same bytes'), attachments: [{ id, name: 'shared', size: bytes.length }] };
  let one = await a.workspace.createCard(body), two = await a.workspace.createCard(body);
  one = await a.workspace.updateCard(one.id, { deleted: true }, one.revision);
  const oldPreview = await a.purge.preview([one.id]), episode = one.trashEpisode;
  one = await a.workspace.restoreCard(one.id, one.revision); one = await a.workspace.updateCard(one.id, { deleted: true }, one.revision);
  assert.notEqual(one.trashEpisode, episode);
  await assert.rejects(a.purge.enqueue(oldPreview), { code: 'stale-purge' });
  await a.purge.enqueue(await a.purge.preview([one.id])); await finish(a.purge);
  assert.ok(await a.storage.getAttachment('local', id));
  two = await a.workspace.updateCard(two.id, { deleted: true }, two.revision);
  await a.purge.enqueue(await a.purge.preview([two.id])); await finish(a.purge);
  assert.equal(await a.storage.getAttachment('local', id), null);
});

test('a confirmed purge drops a large unsent queue in bounded pages without uploading its history', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('queued'));
  for (let i = 0; i < 240; i++) card = await a.workspace.updateCard(card.id, { content: content(`queued ${i}`) }, card.revision);
  card = await a.workspace.updateCard(card.id, { deleted: true }, card.revision);
  await a.purge.enqueue(await a.purge.preview([card.id])); await finish(a.purge);
  assert.equal(a.workspace.pendingCount, 0);
  assert.equal([...provider.files.values()].filter(item => item.file.entityId === card.id && item.file.kind === 'revision').length, 0);
  assert.equal((await a.storage.pendingPage()).operations.length, 0);
});

test('cleanup resumes after a lost folder-delete reply and only the selected identity is retired', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('delete')); await a.sync.sync();
  card = await a.workspace.updateCard(card.id, { deleted: true }, card.revision); await a.sync.sync();
  await a.purge.enqueue(await a.purge.preview([card.id]));
  let failed = false;
  provider.hook = async point => { if (point === 'delete-after' && !failed) { failed = true; throw Object.assign(new Error('reply lost'), { code: 'network' }); } };
  await assert.rejects(finish(a.purge), { code: 'network' }); provider.hook = async () => {};
  await a.sync.stop(); const reopened = await client(provider, a.records);
  await finish(reopened.purge);
  assert.equal(reopened.workspace.snapshot.cards.length, 0);
  assert.equal((await reopened.purge.pending()).length, 0);
});

test('a restored note invalidates only its queued purge; another confirmed Trash item still completes', async () => {
  const a = await client(); let one = await a.workspace.createCard(content('restore')), two = await a.workspace.createCard(content('remove'));
  one = await a.workspace.updateCard(one.id, { deleted: true }, one.revision);
  two = await a.workspace.updateCard(two.id, { deleted: true }, two.revision);
  await a.purge.enqueue(await a.purge.preview([one.id, two.id]));
  await a.workspace.restoreCard(one.id, one.revision);
  const phases = await finish(a.purge);
  assert.ok(phases.includes('needs-preview'));
  assert.deepEqual(a.workspace.snapshot.cards.map(card => card.id), [one.id]);
  assert.equal((await a.purge.pending())[0].phase, 'needs-preview');
});

test('folder-delete denial falls back to bounded metadata cleanup without downloading historical bodies', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('remove'));
  for (let i = 0; i < 30; i++) card = await a.workspace.updateCard(card.id, { content: content(`past ${i}`) }, card.revision);
  card = await a.workspace.updateCard(card.id, { deleted: true }, card.revision);
  while (a.workspace.pendingCount) await a.sync.sync(); await consolidate(provider, a.sync.binding); await a.sync.sync();
  await a.purge.enqueue(await a.purge.preview([card.id])); provider.forbiddenHistory = true;
  const remove = provider.deleteFile.bind(provider);
  provider.deleteFile = async args => {
    const file = provider.files.get(args.id)?.file;
    if (file?.kind === 'folder' && [...provider.files.values()].some(item => item.file.parentId === args.id))
      throw Object.assign(new Error('folder needs explicit child cleanup'), { code: 'source-permission' });
    return remove(args);
  };
  await finish(a.purge);
  assert.equal([...provider.files.values()].filter(item => item.file.entityId === card.id && item.file.kind !== 'purge').length, 0);
});

test('a late orphan is discovered through the incremental feed and cleaned by its terminal entity marker', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('late upload')); await a.sync.sync();
  const original = [...provider.files.values()].find(item => item.file.kind === 'revision' && item.file.entityId === card.id);
  card = await a.workspace.updateCard(card.id, { deleted: true }, card.revision); await a.sync.sync();
  await a.purge.enqueue(await a.purge.preview([card.id])); await finish(a.purge); await a.sync.sync(); await finish(a.purge);
  const file = { ...original.file, id: 'late-orphan', parentId: null };
  provider.files.set(file.id, { file, bytes: original.bytes }); provider.events.push({ id: file.id, file, removed: false });
  provider.forbiddenHistory = true; await a.sync.sync();
  assert.ok((await a.purge.pending()).length > 0); await finish(a.purge);
  assert.equal(provider.files.has('late-orphan'), false); assert.equal(a.workspace.snapshot.cards.length, 0);
});
