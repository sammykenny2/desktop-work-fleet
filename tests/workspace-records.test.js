import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ text, format: 'markdown', attachments: [] });
async function fixture(profileId = 'local') {
  const records = new MemoryRecordStore();
  const storage = new WorkspaceRecordStorage(records, profileId);
  const persist = (...args) => storage.save(...args);
  const workspace = await Workspace.create({ profileId, deviceId: 'device', area, persist, current: true, history: storage });
  return { records, storage, workspace, persist, profileId };
}

test('indexed reads serialize with this writer while retaining competing-writer revision fences', async () => {
  const f = await fixture('google:account');
  const card = await f.workspace.createCard(content('same writer'));
  const page = f.records.page.bind(f.records);
  f.records.page = async (...args) => { await new Promise(resolve => setTimeout(resolve, 1)); return page(...args); };
  const draft = f.workspace.blankDraft(card.groupId, card); draft.content.text = 'foreground edit';
  await Promise.all([f.storage.pendingPage(), f.storage.jobs('dataset-purge'), f.storage.page('card', card.id),
    f.storage.pendingForEntity('card', card.id), f.storage.putJob('background', { kind: 'background' }), f.workspace.saveDraft(draft)]);
  assert.equal(f.workspace.state.drafts[draft.id].content.text, 'foreground edit');
});

test('typing writes only the draft and active revision; startup never reads retained history or pending uploads', async () => {
  const f = await fixture('google:account');
  let card = await f.workspace.createCard(content('initial'));
  for (let i = 0; i < 250; i++) {
    const draft = f.workspace.blankDraft(card.groupId, card); draft.content.text = `revision ${i}`;
    await f.workspace.saveDraft(draft); card = await f.workspace.commitDraft(draft.id);
  }
  assert.equal(f.workspace.state.revisions.length, 2);
  assert.equal(f.workspace.state.outbox.length, 0);
  assert.equal(f.workspace.pendingCount, 252);
  const draft = f.workspace.blankDraft(card.groupId, card); draft.content.text = 'typing';
  const before = f.records.stats;
  await f.workspace.saveDraft(draft);
  assert.equal(f.records.stats.reads - before.reads, 0);
  assert.equal(f.records.stats.writes - before.writes, 2);
  const reads = f.records.stats.reads;
  const storage = new WorkspaceRecordStorage(f.records, f.profileId);
  const saved = await storage.load(f.profileId);
  assert.ok(f.records.stats.reads - reads < 20);
  const reopened = new Workspace(saved, (...args) => storage.save(...args), undefined, undefined, { history: storage });
  assert.equal(reopened.pendingCount, 252);
  assert.equal(reopened.working.cards[0].content.text, 'typing');
  assert.equal(reopened.state.revisions.length, 2);
  const page = await reopened.historyPage('card', card.id, { limit: 20 });
  assert.equal(page.records.length, 20); assert.ok(page.next);
  assert.equal((await reopened.historyPage('card', card.id, { after: page.next, limit: 20 })).records.length, 20);
  assert.equal((await storage.completeHistory(reopened.state)).length, 252);
});

test('unsaved baseline survives unavailable historical bodies and metadata changes', async () => {
  const f = await fixture();
  let card = await f.workspace.createCard(content('original'));
  const draft = f.workspace.blankDraft(card.groupId, card); draft.content.text = 'unsaved';
  await f.workspace.saveDraft(draft);
  card = await f.workspace.updateCard(card.id, { completed: true }, card.revision);
  const saved = f.workspace.state.drafts[draft.id];
  assert.equal(saved.baseContent.text, 'original');
  assert.equal(saved.baseRevision, card.revision);
  const result = await f.workspace.commitDraft(saved.id);
  assert.equal(result.content.text, 'unsaved');
  assert.equal(f.workspace.pendingCount, 0, 'local-only profiles do not accumulate pending uploads');
});

test('acknowledgement removes only existing operations in the same durable transaction', async () => {
  const f = await fixture('google:account');
  await f.workspace.createCard(content('note'));
  const session = await f.workspace.beginSync('drive');
  const { operations } = await f.storage.pendingPage();
  assert.equal(operations.length, 2);
  await f.workspace.acknowledgeOperations(session, [operations[0].operationId]);
  const before = f.workspace.state;
  await assert.rejects(f.workspace.acknowledgeOperations(session, [operations[0].operationId]), { code: 'stale-writer' });
  assert.deepEqual(f.workspace.state, before);
  assert.equal(f.workspace.pendingCount, 1);
  assert.equal((await f.storage.pendingPage()).operations.length, 1);
  assert.equal(await f.workspace.completeSync(session, new Date().toISOString()), false);
});

test('a competing writer cannot acknowledge a draft or current value and old profiles are preserved', async () => {
  const f = await fixture();
  const other = new WorkspaceRecordStorage(f.records, f.profileId);
  const saved = await other.load(f.profileId);
  const workspace = new Workspace(saved, (...args) => other.save(...args), undefined, undefined, { history: other });
  await f.workspace.createCard(content('first'));
  await assert.rejects(workspace.createCard(content('second')), { code: 'stale-writer' });
  assert.deepEqual(workspace.snapshot.cards, []);
  const old = new WorkspaceRecordStorage({ status: async () => ({ format: 'legacy-workspace', profileId: 'old' }),
    get: () => assert.fail('must not load old payload') }, 'old');
  await assert.rejects(old.load('old'), { code: 'incompatible-local-data' });
});

test('large initial current state is staged and an interrupted replacement leaves the old generation active', async () => {
  const f = await fixture();
  const state = f.workspace.state;
  const history = Array.from({ length: 700 }, (_, i) => ({ ...state.revisions[0], revisionId: `r${i}`,
    value: { ...state.revisions[0].value, revision: `r${i}` } }));
  state.revision++;
  const realCommit = f.records.commit.bind(f.records); let calls = 0;
  f.records.commit = async (...args) => { if (++calls === 2) throw new Error('disk full'); return realCommit(...args); };
  await assert.rejects(f.storage.save(state, state.revision - 1, { replaceGeneration: true, history }), /disk full/);
  const reopened = new WorkspaceRecordStorage(f.records, f.profileId);
  const original = await reopened.load(f.profileId);
  assert.equal(original.revision, 0);
  assert.equal((await reopened.completeHistory(original)).length, 1);
  f.records.commit = realCommit;
  await reopened.save(state, original.revision, { replaceGeneration: true, history });
  assert.equal((await reopened.completeHistory(await reopened.load(f.profileId))).length, 700);
});

test('durable jobs share the receipt queue and bulk current replacement preserves history and pending order', async () => {
  const f = await fixture('google:account');
  const card = await f.workspace.createCard(content('original'));
  await f.storage.putJob('test-job', { kind: 'test', fileId: 'fixed-id' });
  await f.workspace.updateCard(card.id, { content: content('new') }, card.revision);
  const state = f.workspace.state, before = await f.storage.pendingPage(); state.revision++;
  const additions = Array.from({ length: 600 }, (_, i) => ({ ...state.revisions[0], revisionId: `bulk-${i}`,
    entityId: `entity-${i}`, parents: [], value: { ...state.revisions[0].value, id: `entity-${i}`, revision: `bulk-${i}` } }));
  state.revisions.push(...additions);
  await f.storage.save(state, state.revision - 1, { previous: f.workspace.state, additions });
  assert.deepEqual((await f.storage.pendingPage()).operations, before.operations);
  assert.equal((await f.storage.page('card', card.id)).records.length, 2);
  const reopened = new WorkspaceRecordStorage(f.records, f.profileId); await reopened.load(f.profileId);
  assert.deepEqual(await reopened.getJob('test-job'), { kind: 'test', fileId: 'fixed-id' });
  assert.equal((await reopened.get(card.revision)).value.content.text, 'original');
});


test('generation replacement collects attachment bytes saved before a draft acquired ownership', async () => {
  const f = await fixture();
  const file = await f.storage.putAttachment('local', new Blob(['interrupted attachment']));
  assert.ok(await f.storage.getAttachment('local', file.id));
  const before = f.workspace.state, replacement = { ...before, revision: before.revision + 1 };
  await f.storage.save(replacement, before.revision, { replaceGeneration: true });
  let passes = 0;
  while (await f.storage.maintenance()) assert.ok(++passes < 100, 'bounded fixture cleanup must finish');
  assert.equal(await f.storage.getAttachment('local', file.id), null);
});
