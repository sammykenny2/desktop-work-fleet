import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { saveSafetyBackup } from '../src/backup/restore.js';
import { prepareCloudRestore, stageCloudRestore, resumeCloudRestore } from '../src/backup/cloud-restore.js';
import { FileSync } from '../src/sources/file-sync.js';
import { sha256 } from '../src/sources/files.js';
import { MemoryFileStore, MemoryAttachmentStorage } from './fixtures/file-store.js';

const area = { x: 0, y: 0, width: 1400, height: 900 };
const text = value => ({ format: 'markdown', text: value });
const fails = code => error => error.code === code;

async function client(profileId, bootstrapGroup = false) {
  let disk; let failSave = false;
  const attachments = new MemoryAttachmentStorage();
  const save = async (state, revision) => {
    assert.equal(disk?.revision ?? null, revision);
    if (failSave) throw new Error('disk full');
    disk = copy(state);
  };
  const storage = { save, load: async () => copy(disk),
    getAttachment: (...args) => attachments.getAttachment(...args),
    putAttachmentBytes: (...args) => attachments.putAttachmentBytes(...args),
    saveWithAttachments: async (state, revision, files) => {
      if (failSave) throw new Error('disk full');
      for (const file of files) assert.equal(await sha256(file.bytes), file.id);
      await save(state, revision);
      for (const file of files) await attachments.putAttachmentBytes(profileId, file.id, file.bytes);
    } };
  const workspace = await Workspace.create({ profileId, bootstrapGroup, deviceId: crypto.randomUUID(), area, persist: save });
  return { workspace, storage, disk: () => copy(disk), fail: value => { failSave = value; } };
}

async function scenario() {
  const local = await client('local', true);
  const bytes = new TextEncoder().encode('完整附件'); const id = await sha256(bytes);
  await local.storage.putAttachmentBytes('local', id, bytes);
  const group = local.workspace.snapshot.groups[0];
  const card = await local.workspace.createCard({ ...text('本機備份內容'), attachments: [{ id, name: 'note.txt', size: bytes.length }] }, group.id);
  const draft = local.workspace.blankDraft(group.id); draft.content.text = '本機未完成草稿'; await local.workspace.saveDraft(draft);
  const document = await openBackup((await createBackup({ workspace: local.workspace, storage: local.storage })).bytes);
  const remote = await client('google:account-a', true); const store = new MemoryFileStore();
  const oldCard = await remote.workspace.createCard(text('不要留下的雲端內容'), remote.workspace.snapshot.groups[0].id);
  const oldDraft = remote.workspace.blankDraft(oldCard.groupId); oldDraft.content.text = '舊 Google 草稿'; await remote.workspace.saveDraft(oldDraft);
  const sync = new FileSync({ workspace: remote.workspace, storage: remote.storage, fileStore: store });
  await sync.sync(); await sync.stop({ endSession: false });
  const oldIds = [...store.files.keys()];
  const plan = await prepareCloudRestore({ workspace: remote.workspace, document, sourceId: store.sourceId, workAreas: [area] });
  let safetyDocument;
  const safetyBackup = await saveSafetyBackup({ workspace: remote.workspace, storage: remote.storage,
    save: async ({ bytes: saved }) => { safetyDocument = await openBackup(saved); return { saved: true, receipt: 'confirmed-file' }; } });
  return { local, remote, store, plan, safetyBackup, safetyDocument, oldIds, card, draft, oldCard, oldDraft, id, bytes };
}

test('local export replaces all Google history and attachments, and a fresh device receives only backup content', async () => {
  const s = await scenario(); const beforeCalls = s.store.calls.length;
  assert.ok(s.safetyDocument.data.records.some(record => record.entityId === s.oldCard.id));
  assert.equal(s.plan.preview.mode, 'cloud-replace');
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  assert.equal(s.store.calls.length, beforeCalls, 'staging cannot delete remote data');
  assert.equal(s.remote.disk().cloudRestore.phase, 'reset');
  const observer = await client('google:account-a');
  const observerSync = new FileSync({ workspace: observer.workspace, storage: observer.storage, fileStore: s.store });
  await observerSync.sync();
  await resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store });
  for (const id of s.oldIds) assert.equal(s.store.files.has(id), false);
  assert.equal(s.remote.disk().cloudRestore, undefined);
  assert.equal(s.remote.disk().cards.some(card => card.id === s.oldCard.id), false);
  assert.equal(s.remote.disk().drafts[s.oldDraft.id], undefined);
  assert.equal(s.remote.disk().drafts[s.draft.id].content.text, s.draft.content.text);
  await assert.rejects(observerSync.sync({ force: true }), fails('source-reset'));
  const fresh = await client('google:account-a');
  const sync = new FileSync({ workspace: fresh.workspace, storage: fresh.storage, fileStore: s.store });
  await sync.sync();
  assert.deepEqual(fresh.workspace.snapshot.cards.map(card => card.content), [s.card.content]);
  assert.deepEqual(new Uint8Array(await (await fresh.storage.getAttachment('google:account-a', s.id)).arrayBuffer()), s.bytes);
  assert.deepEqual(fresh.workspace.state.drafts, {}, 'drafts stay local until explicitly published');
  assert.equal(fresh.workspace.state.revisions.some(record => record.entityId === s.oldCard.id), false);
});

test('missing safety backup, stale preview, wrong account and disk failure cannot start a remote reset', async () => {
  const s = await scenario(); const calls = s.store.calls.length;
  const args = { workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan };
  await assert.rejects(stageCloudRestore(args), fails('missing-safety-backup'));
  await assert.rejects(stageCloudRestore({ ...args, safetyBackup: s.safetyBackup, fileStore: { sourceId: 'other-account' } }), fails('restore-profile'));
  s.remote.fail(true);
  await assert.rejects(stageCloudRestore({ ...args, safetyBackup: s.safetyBackup }), /disk full/);
  s.remote.fail(false);
  await s.remote.workspace.createCard(text('預覽後新增'), s.oldCard.groupId);
  await assert.rejects(stageCloudRestore({ ...args, safetyBackup: s.safetyBackup }), fails('stale-restore-plan'));
  assert.equal(s.store.calls.length, calls);
  for (const id of s.oldIds) assert.equal(s.store.files.has(id), true);
});

test('partial reset survives a restart, blocks ordinary sync and resumes from the durable replacement', async () => {
  const s = await scenario();
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  const normal = new FileSync({ workspace: new Workspace(s.remote.disk(), s.remote.storage.save), storage: s.remote.storage, fileStore: s.store });
  const calls = s.store.calls.length;
  await assert.rejects(normal.sync(), fails('cloud-restore-pending')); assert.equal(s.store.calls.length, calls);
  s.store.hooks.deleteFile = () => { throw new FleetError('source-permission', 'cannot delete'); };
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('source-permission'));
  assert.equal(s.remote.disk().cloudRestore.phase, 'reset');
  assert.equal(s.remote.disk().cards[0].content.text, s.card.content.text);
  delete s.store.hooks.deleteFile;
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.remote.disk().cloudRestore, undefined);
});

test('upload failure survives a restart and retries without resetting the restored cloud a second time', async () => {
  const s = await scenario();
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  s.store.hooks.createFile = input => { if (input.file.kind !== 'reset') throw new FleetError('source-permission', 'cannot upload'); };
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('source-permission'));
  assert.equal(s.remote.disk().cloudRestore.phase, 'upload');
  const deleted = s.store.calls.filter(call => call.method === 'deleteFile').length;
  delete s.store.hooks.createFile;
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.store.calls.filter(call => call.method === 'deleteFile').length, deleted);
  assert.equal(s.remote.disk().cloudRestore, undefined);
});

test('an interrupted job cannot resume against a different Google account', async () => {
  const s = await scenario();
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  const store = new MemoryFileStore(); store.sourceId = 'other-account';
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: store }), fails('restore-profile'));
  assert.equal(store.calls.length, 0);
});

test('a lost staging acknowledgement still leaves a complete durable job before any remote deletion', async () => {
  const s = await scenario(); const save = s.remote.storage.saveWithAttachments;
  const calls = s.store.calls.length;
  s.remote.storage.saveWithAttachments = async (...args) => { await save(...args); throw new Error('lost save response'); };
  await assert.rejects(stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store,
    plan: s.plan, safetyBackup: s.safetyBackup }), /lost save response/);
  assert.equal(s.store.calls.length, calls);
  assert.equal(s.remote.disk().cloudRestore.phase, 'reset');
  assert.equal(await sha256(new Uint8Array(await (await s.remote.storage.getAttachment('google:account-a', s.id)).arrayBuffer())), s.id);
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.remote.disk().cloudRestore, undefined);
});

test('a lost upload response resumes the reserved file without another reset or duplicate remote content', async () => {
  const s = await scenario();
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  let lost = false;
  s.store.hooks.afterCreate = input => {
    if (!lost && input.file.kind !== 'reset') { lost = true; throw new FleetError('network', 'lost upload response'); }
  };
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('network'));
  const uploaded = s.store.calls.filter(call => call.method === 'createFile' && call.file.kind !== 'reset').at(-1).file;
  const deleted = s.store.calls.filter(call => call.method === 'deleteFile').length;
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.store.calls.filter(call => call.method === 'deleteFile').length, deleted);
  assert.equal(s.store.calls.filter(call => call.method === 'createFile' && call.file.id === uploaded.id).length, 2);
  assert.equal([...s.store.files.values()].filter(item => item.file.kind === uploaded.kind && item.file.sha256 === uploaded.sha256).length, 1);
  assert.equal(s.remote.disk().cloudRestore, undefined);
});
