import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetLifecycle } from '../src/sources/dataset-lifecycle.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetProtocol } from '../src/sources/dataset-protocol.js';
import { datasetRecord, datasetShard } from '../src/sources/dataset-codec.js';
import { sha256 } from '../src/sources/files.js';
import { DatasetTestJournal, DatasetTestProvider } from './fixtures/dataset/provider.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });
async function client(provider, records = new MemoryRecordStore()) {
  const profileId = 'google:test', storage = new WorkspaceRecordStorage(records, profileId);
  const saved = await storage.load(profileId), persist = (...args) => storage.save(...args);
  const workspace = saved ? new Workspace(saved, persist, undefined, undefined, { history: storage })
    : await Workspace.create({ profileId, deviceId: crypto.randomUUID(), area, persist, current: true, bootstrapGroup: false, history: storage });
  return { records, storage, workspace, sync: new DatasetSync({ workspace, storage, fileStore: provider }) };
}

test('initialization durably reserves exact IDs and a follower sees only a verified ready dataset', async () => {
  const provider = new DatasetTestProvider(), journal = new DatasetTestJournal(), lifecycle = new DatasetLifecycle(provider, journal);
  assert.equal((await lifecycle.inspect()).phase, 'empty');
  let failed = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'folder' && !failed) { failed = true; throw Object.assign(new Error('offline'), { code: 'service-unavailable' }); }
  };
  await assert.rejects(lifecycle.initialize(), { code: 'service-unavailable' });
  const reserved = provider.counter;
  provider.hook = async () => {};
  const binding = await lifecycle.initialize();
  assert.equal(provider.counter, reserved);
  assert.deepEqual((await lifecycle.inspect()).binding, binding);
  const protocol = new DatasetProtocol(provider, journal);
  const result = await protocol.reconcile(binding.descriptor, binding.plan);
  assert.equal(result.heads.length, 1); assert.equal(result.heads[0].record.kind, 'group');
});

test('readiness acknowledgement loss never recreates initial checkpoints consumed by another client', async () => {
  const provider = new DatasetTestProvider(), journal = new DatasetTestJournal();
  const original = journal.putJob.bind(journal); let failed = false;
  journal.putJob = async (key, value) => { if (value.phase === 'ready' && !failed) { failed = true; throw new Error('disk full'); } return original(key, value); };
  const lifecycle = new DatasetLifecycle(provider, journal);
  await assert.rejects(lifecycle.initialize(), /disk full/);
  const binding = (await lifecycle.inspect()).binding;
  const protocol = new DatasetProtocol(provider, new DatasetTestJournal());
  const inputs = await protocol.captureShard(binding.plan, 'groups');
  const successor = await protocol.checkpoint(binding.plan, 'groups', inputs);
  await protocol.retire(binding.descriptor, binding.plan, successor);
  const creates = provider.stats.creates;
  assert.deepEqual(await lifecycle.initialize(), binding);
  assert.equal(provider.stats.creates, creates);
  assert.equal(provider.files.has(inputs[0].file.id), false);
});

test('concurrent independent initialization plans stay a conflict; no timestamp or empty winner', async () => {
  const provider = new DatasetTestProvider();
  await new DatasetLifecycle(provider, new DatasetTestJournal()).initialize();
  await new DatasetLifecycle(provider, new DatasetTestJournal()).initialize({ allowExisting: true, starter: false });
  assert.equal((await new DatasetLifecycle(provider, new DatasetTestJournal()).inspect()).phase, 'conflict');
  const c = await client(provider);
  await assert.rejects(c.sync.sync(), { code: 'initialization-conflict' });
  assert.equal(c.workspace.snapshot.groups.length, 0);
});

test('current sync reopens from records, preserves unsent edits and publishes one history body per save', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider);
  await a.sync.sync();
  let card = await a.workspace.createCard(content('first'));
  for (let i = 0; i < 75; i++) card = await a.workspace.updateCard(card.id, { content: content(`edit ${i}`) }, card.revision);
  assert.equal(a.workspace.pendingCount, 76);
  await a.sync.sync(); assert.equal(a.workspace.pendingCount, 44);
  assert.ok(a.workspace.snapshot.cards.some(value => value.content.text === 'edit 74'));
  await a.sync.stop();
  const reopened = await client(provider, a.records);
  while (reopened.workspace.pendingCount) await reopened.sync.sync({ force: true });
  assert.equal(reopened.workspace.snapshot.cards[0].content.text, 'edit 74');
  assert.equal(reopened.workspace.snapshot.conflicts.length, 0);
  const bodies = [...provider.files.values()].filter(item => item.file.kind === 'revision' && item.file.entityId === card.id);
  assert.equal(bodies.length, 76);
  assert.equal(new Set(bodies.map(item => item.file.revisionId)).size, 76);
  const follower = await client(provider); await follower.sync.sync();
  assert.equal(follower.workspace.snapshot.cards[0].content.text, 'edit 74');
  assert.equal(follower.workspace.state.revisions.length, 2);
});

test('publication journals retain locators without another copy of note contents', async () => {
  const provider = new DatasetTestProvider(), c = await client(provider); await c.sync.sync();
  const card = await c.workspace.createCard(content('unique unpublished private body'));
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'revision') throw Object.assign(new Error('offline'), { code: 'service-unavailable' });
  };
  await assert.rejects(c.sync.sync(), { code: 'service-unavailable' });
  const job = await c.storage.getJob(`upload:${c.sync.binding.plan.datasetId}:${card.revision}`);
  assert.ok(job.revision.sha256); assert.equal(JSON.stringify(job).includes('unique unpublished private body'), false);
  provider.hook = async () => {}; await c.sync.sync({ force: true });
  assert.equal(c.workspace.pendingCount, 0);
  assert.equal([...provider.files.values()].filter(item => item.file.revisionId === card.revision && item.file.kind === 'revision').length, 1);
});

test('steady sync and cold checkpoint login never fetch retained bodies, at fixed current state', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  await a.workspace.createCard(content('only')); await a.sync.sync();
  const binding = a.sync.binding, protocol = new DatasetProtocol(provider, new DatasetTestJournal());
  const shard = await datasetShard('card', a.workspace.snapshot.cards[0].id);
  const inputs = await protocol.captureShard(binding.plan, shard);
  await protocol.retire(binding.descriptor, binding.plan, await protocol.checkpoint(binding.plan, shard, inputs));
  await a.sync.sync(); provider.forbiddenHistory = true; provider.unrelatedHistory = 1_000_000;
  const before = { ...provider.stats }; let checkpointReads = 0;
  provider.hook = async (point, id) => { if (point === 'read' && provider.files.get(id)?.file.kind === 'checkpoint') checkpointReads++; };
  await a.sync.sync();
  assert.equal(provider.stats.historyReads, before.historyReads);
  assert.equal(checkpointReads, 0, 'steady sync reads control records, not all current checkpoint bodies');
  const follower = await client(provider); await follower.sync.sync();
  assert.equal(follower.workspace.snapshot.cards.length, 1);
  assert.equal(provider.stats.historyReads, before.historyReads);
});

test('purge blocks offline publication and preserves distinct unpublished text for an explicit new identity', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  let card = await a.workspace.createCard(content('published')); await a.sync.sync();
  card = await a.workspace.updateCard(card.id, { content: content('offline edit') }, card.revision);
  const binding = a.sync.binding, protocol = new DatasetProtocol(provider, new DatasetTestJournal());
  const shard = await datasetShard('card', card.id);
  const marker = datasetRecord(binding.plan.datasetId, 'purge', { operationId: crypto.randomUUID(), entityId: card.id,
    folderIds: [], trashEpisode: crypto.randomUUID(), heads: [card.revision] });
  await protocol.publish('purge', binding.plan.folders.buckets[shard], marker);
  await a.sync.sync();
  assert.equal(a.workspace.snapshot.cards.length, 0); assert.equal(a.workspace.pendingCount, 0);
  const draft = Object.values(a.workspace.state.drafts).find(draft => draft.content.text === 'offline edit');
  assert.ok(draft?.purged);
  await assert.rejects(a.workspace.commitDraft(draft.id), { code: 'dataset-purged' });
  const recovered = await a.workspace.commitDraft(draft.id, { asCopy: true });
  assert.notEqual(recovered.id, card.id);
  await a.sync.sync(); assert.equal(a.workspace.snapshot.cards[0].id, recovered.id);
});

test('cloud generation loss preserves local records without republishing any file', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  await a.workspace.createCard(content('keep me')); await a.sync.sync();
  const before = provider.stats.creates; await provider.deleteFile({ id: a.sync.binding.plan.rootId });
  await assert.rejects(a.sync.sync(), { code: 'dataset-changed' });
  assert.equal(provider.stats.creates, before); assert.equal(a.workspace.snapshot.cards[0].content.text, 'keep me');
});

test('an uncertain receipt consumed before restart is acknowledged without uploading another body or receipt', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const card = await a.workspace.createCard(content('once')); let failed = false;
  provider.hook = async (point, id) => {
    if (point === 'create-after' && provider.files.get(id)?.file.kind === 'change' && !failed) {
      failed = true; throw Object.assign(new Error('reply lost'), { code: 'service-unavailable' });
    }
  };
  await assert.rejects(a.sync.sync(), { code: 'service-unavailable' }); assert.equal(a.workspace.pendingCount, 1);
  provider.hook = async () => {};
  const { descriptor, plan } = a.sync.binding, protocol = new DatasetProtocol(provider, new DatasetTestJournal());
  const shard = await datasetShard('card', card.id), inputs = await protocol.captureShard(plan, shard);
  await protocol.retire(descriptor, plan, await protocol.checkpoint(plan, shard, inputs));
  await a.sync.stop(); const resumed = await client(provider, a.records), creates = provider.stats.creates;
  await resumed.sync.sync(); assert.equal(resumed.workspace.pendingCount, 0);
  assert.equal(provider.stats.creates, creates);
  assert.equal((await resumed.storage.pendingPage()).operations.length, 0);
});

test('note copies own separate remote attachments and concurrent edits remain explicit branches', async () => {
  const provider = new DatasetTestProvider(), a = await client(provider); await a.sync.sync();
  const bytes = new TextEncoder().encode('shared attachment'), id = await sha256(bytes);
  await a.storage.putAttachmentBytes('google:test', id, bytes);
  const body = { ...content('with file'), attachments: [{ id, size: bytes.length, name: 'example.txt', mediaType: 'text/plain' }] };
  const card = await a.workspace.createCard(body); await a.sync.sync();
  await a.workspace.createCard(body); await a.sync.sync();
  const attachments = [...provider.files.values()].filter(item => item.file.kind === 'attachment');
  assert.equal(attachments.length, 2); assert.notEqual(attachments[0].file.parentId, attachments[1].file.parentId);
  const b = await client(provider); await b.sync.sync();
  await a.workspace.updateCard(card.id, { content: content('a edit') }, card.revision);
  await b.workspace.updateCard(card.id, { content: content('b edit') }, card.revision);
  await a.sync.sync(); await b.sync.sync(); await a.sync.sync();
  assert.equal(a.workspace.revisionHeads('card', card.id).length, 2);
  assert.equal(b.workspace.revisionHeads('card', card.id).length, 2);
});
