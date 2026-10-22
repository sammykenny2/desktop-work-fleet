import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { saveSafetyBackup } from '../src/backup/restore.js';
import { prepareCloudRestore, stageCloudRestore, resumeCloudRestore } from '../src/backup/cloud-restore.js';
import { FileSync, resetSource } from '../src/sources/file-sync.js';
import { sha256 } from '../src/sources/files.js';
import { revisionRecord } from '../src/sources/revisions.js';
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
  const bytes = new TextEncoder().encode('complete attachment'); const id = await sha256(bytes);
  await local.storage.putAttachmentBytes('local', id, bytes);
  const group = local.workspace.snapshot.groups[0];
  const card = await local.workspace.createCard({ ...text('Local backup content'), attachments: [{ id, name: 'note.txt', size: bytes.length }] }, group.id);
  const draft = local.workspace.blankDraft(group.id); draft.content.text = 'Unfinished local draft'; await local.workspace.saveDraft(draft);
  const document = await openBackup((await createBackup({ workspace: local.workspace, storage: local.storage })).bytes);
  const remote = await client('google:account-a', true); const store = new MemoryFileStore();
  const oldCard = await remote.workspace.createCard(text('Cloud content to drop'), remote.workspace.snapshot.groups[0].id);
  const oldDraft = remote.workspace.blankDraft(oldCard.groupId); oldDraft.content.text = 'Old Google draft'; await remote.workspace.saveDraft(oldDraft);
  const sync = new FileSync({ workspace: remote.workspace, storage: remote.storage, fileStore: store });
  await sync.sync(); await sync.stop({ endSession: false });
  const oldIds = [...store.files.keys()];
  const plan = await prepareCloudRestore({ workspace: remote.workspace, document, sourceId: store.sourceId, workAreas: [area] });
  let safetyDocument;
  const safetyBackup = await saveSafetyBackup({ workspace: remote.workspace, storage: remote.storage,
    save: async ({ bytes: saved }) => { safetyDocument = await openBackup(saved); return { saved: true, receipt: 'confirmed-file' }; } });
  return { local, remote, store, plan, safetyBackup, safetyDocument, oldIds, card, draft, oldCard, oldDraft, id, bytes };
}

test('explicit same-account backup overwrite republishes an automatic initial group and its notes in the current source generation', async () => {
  const store = new MemoryFileStore(); const original = await client('google:account-a');
  const sync = new FileSync({ workspace: original.workspace, storage: original.storage, fileStore: store, bootstrapGroup: true });
  await sync.sync(); const group = original.workspace.snapshot.groups[0];
  const card = await original.workspace.createCard(text('Explicitly restored note'), group.id); await sync.sync(); await sync.stop();
  const document = await openBackup((await createBackup({ workspace: original.workspace, storage: original.storage })).bytes);
  const plan = await prepareCloudRestore({ workspace: original.workspace, document, sourceId: store.sourceId, workAreas: [area] });
  const safetyBackup = await saveSafetyBackup({ workspace: original.workspace, storage: original.storage,
    save: async () => ({ saved: true, receipt: 'confirmed-file' }) });
  await stageCloudRestore({ workspace: original.workspace, storage: original.storage, fileStore: store, plan, safetyBackup });
  await resumeCloudRestore({ state: original.disk(), storage: original.storage, fileStore: store });
  const fresh = await client('google:account-a');
  await new FileSync({ workspace: fresh.workspace, storage: fresh.storage, fileStore: store, bootstrapGroup: true }).sync();
  assert.deepEqual(fresh.workspace.snapshot.groups, [group]); assert.deepEqual(fresh.workspace.snapshot.cards, [card]);
  assert.deepEqual(fresh.workspace.state.conflicts, []);
  assert.equal(fresh.workspace.state.revisions.length, 2, 'portable root and note identities are retained by explicit restore');
});

test('an overwrite keeps the layout of this device for what the backup holds unless the backup layout is chosen', async () => {
  const store = new MemoryFileStore(); const device = await client('google:account-a', true);
  const [a] = device.workspace.snapshot.groups; const b = await device.workspace.createGroup('B');
  const kept = await device.workspace.createCard(text('Kept note'), a.id); await device.workspace.createCard(text('B note'), b.id);
  await device.workspace.layout.placeNew(device.workspace.snapshot, [area]);
  const document = await openBackup((await createBackup({ workspace: device.workspace, storage: device.storage })).bytes);
  // Settings changed after the backup, and a group and a note the backup does not hold.
  const c = await device.workspace.createGroup('C'); const extra = await device.workspace.createCard(text('Not in the backup'), c.id);
  await device.workspace.layout.placeNew(device.workspace.snapshot, [area]);
  await device.workspace.layout.move(kept.id, { x: 700, y: 500 });
  for (const group of [a, c]) await device.workspace.layout.setGroupLayer(group.id, 'floating', device.workspace.snapshot);
  await device.workspace.layout.configure({ myGroupId: b.id, mainView: 'list', completedVisible: true,
    shortcuts: { ...device.workspace.layout.state.shortcuts, 'Alt+F2': '@capture' } }, device.workspace.snapshot);
  await device.workspace.layout.setMainGroup(c.id, device.workspace.snapshot);
  const before = device.workspace.layout.state; assert.ok(before.history.length > 0);
  const overwrite = async layout => {
    const plan = await prepareCloudRestore({ workspace: device.workspace, document, sourceId: store.sourceId, workAreas: [area], layout });
    const safetyBackup = await saveSafetyBackup({ workspace: device.workspace, storage: device.storage,
      save: async () => ({ saved: true, receipt: 'confirmed-file' }) });
    return plan.materialize(device.workspace.state, safetyBackup, store.sourceId);
  };

  const next = await overwrite('preserve'); const layout = next.layout;
  assert.deepEqual(layout.placements[kept.id], before.placements[kept.id]); assert.equal(layout.placements[extra.id], undefined);
  assert.deepEqual(layout.groupLayers, { [a.id]: 'floating' });
  assert.deepEqual(layout.groupColors, { [a.id]: before.groupColors[a.id], [b.id]: before.groupColors[b.id] });
  assert.deepEqual(layout.grid, { ...before.grid, slots: before.grid.slots.map(id => id === c.id ? null : id) }, 'this device keeps its grid');
  assert.deepEqual(layout.history, []);
  assert.equal(layout.myGroupId, b.id); assert.equal(layout.mainGroupId, undefined, 'a remembered group the backup lacks is dropped');
  assert.equal(layout.mainView, 'list'); assert.equal(layout.completedVisible, true); assert.equal(layout.shortcuts['Alt+F2'], '@capture');
  assert.equal(layout.deviceId, before.deviceId); assert.ok(layout.revision > before.revision);
  // The restored copy must still pass every reference check of the next backup.
  await openBackup((await createBackup({ workspace: new Workspace(next, async () => {}), storage: device.storage })).bytes);

  const applied = (await overwrite('backup')).layout; const backupLayout = document.data.layout;
  assert.deepEqual(applied.placements[kept.id], backupLayout.placements[kept.id]); assert.deepEqual(applied.shortcuts, backupLayout.shortcuts);
  assert.equal(applied.mainView, undefined); assert.equal(applied.myGroupId, null); assert.deepEqual(applied.groupLayers, {});
  assert.ok(applied.revision > before.revision, 'the layout revision never goes back');
});

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
  await s.remote.workspace.createCard(text('Added after the preview'), s.oldCard.groupId);
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
  s.store.hooks.createFile = input => { if (['revision', 'attachment'].includes(input.file.kind)) throw new FleetError('source-permission', 'cannot upload'); };
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('source-permission'));
  assert.equal(s.remote.disk().cloudRestore.phase, 'upload');
  const follower = await client('google:account-a');
  const followerSync = new FileSync({ workspace: follower.workspace, storage: follower.storage, fileStore: s.store, bootstrapGroup: true });
  assert.equal((await followerSync.sync()).phase, 'waiting-initialization');
  assert.deepEqual(follower.workspace.snapshot.groups, []); assert.deepEqual(follower.workspace.snapshot.cards, []);
  const deleted = s.store.calls.filter(call => call.method === 'deleteFile').length;
  delete s.store.hooks.createFile;
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.store.calls.filter(call => call.method === 'deleteFile').length, deleted);
  assert.equal(s.remote.disk().cloudRestore, undefined);
  const creates = s.store.calls.filter(call => call.method === 'createFile').length;
  await followerSync.sync(); assert.equal(follower.workspace.snapshot.cards[0].content.text, s.card.content.text);
  assert.equal(s.store.calls.filter(call => call.method === 'createFile').length, creates, 'restore followers only download');
});

test('a backup containing unresolved parent history completes initialization without discarding its pending revisions', async () => {
  const local = await client('local', true); const session = await local.workspace.beginSync('history-fixture');
  const pending = revisionRecord('group', { id: 'pending-group', revision: 'pending-revision', name: 'Group still pending', deleted: false }, ['missing-parent']);
  await local.workspace.receiveRevisions([pending], { session, expectedCursor: null, cursor: 'history' });
  const document = await openBackup((await createBackup({ workspace: local.workspace, storage: local.storage })).bytes);
  const remote = await client('google:account-a'); const store = new MemoryFileStore();
  const plan = await prepareCloudRestore({ workspace: remote.workspace, document, sourceId: store.sourceId, workAreas: [area] });
  const safetyBackup = await saveSafetyBackup({ workspace: remote.workspace, storage: remote.storage, save: async () => ({ saved: true, receipt: 'safe' }) });
  await stageCloudRestore({ workspace: remote.workspace, storage: remote.storage, fileStore: store, plan, safetyBackup });
  await resumeCloudRestore({ state: remote.disk(), storage: remote.storage, fileStore: store });
  assert.equal(remote.disk().cloudRestore, undefined); assert.ok(remote.disk().sync.initialization.activePlan);
  const fresh = await client('google:account-a');
  await new FileSync({ workspace: fresh.workspace, storage: fresh.storage, fileStore: store, bootstrapGroup: true }).sync();
  assert.ok(fresh.workspace.state.conflicts.some(conflict => conflict.kind === 'pending-revisions' && conflict.revisions.length));
  assert.equal(fresh.workspace.state.revisions.length, local.workspace.state.revisions.length);
});

test('an interrupted job cannot resume against a different Google account', async () => {
  const s = await scenario();
  await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
  const store = new MemoryFileStore(); store.sourceId = 'other-account';
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: store }), fails('restore-profile'));
  assert.equal(store.calls.length, 0);
});

test('a restore writer cannot follow a later reset or relabel its backup outbox, even before its first source read', async () => {
  for (const boundary of ['getStartCursor', 'createFile']) {
    const s = await scenario();
    await stageCloudRestore({ workspace: s.remote.workspace, storage: s.remote.storage, fileStore: s.store, plan: s.plan, safetyBackup: s.safetyBackup });
    s.store.hooks[boundary] = input => {
      if (boundary === 'getStartCursor' || ['revision', 'attachment'].includes(input.file.kind)) throw new FleetError('interrupted', 'stop upload');
    };
    await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('interrupted'));
    delete s.store.hooks[boundary]; await resetSource(s.store);
    const files = [...s.store.files.keys()]; const count = s.store.calls.length;
    await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }),
      error => ['source-reset', 'source-reset-superseded'].includes(error.code));
    assert.deepEqual([...s.store.files.keys()], files);
    assert.equal(s.store.calls.slice(count).some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
    assert.equal(s.remote.disk().cards[0].content.text, s.card.content.text);
  }
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
    if (!lost && ['revision', 'attachment'].includes(input.file.kind)) { lost = true; throw new FleetError('network', 'lost upload response'); }
  };
  await assert.rejects(resumeCloudRestore({ state: s.remote.disk(), storage: s.remote.storage, fileStore: s.store }), fails('network'));
  const uploaded = s.store.calls.filter(call => call.method === 'createFile' && ['revision', 'attachment'].includes(call.file.kind)).at(-1).file;
  const deleted = s.store.calls.filter(call => call.method === 'deleteFile').length;
  await resumeCloudRestore({ state: await s.remote.storage.load(), storage: s.remote.storage, fileStore: s.store });
  assert.equal(s.store.calls.filter(call => call.method === 'deleteFile').length, deleted);
  assert.equal(s.store.calls.filter(call => call.method === 'createFile' && call.file.id === uploaded.id).length, 2);
  assert.equal([...s.store.files.values()].filter(item => item.file.kind === uploaded.kind && item.file.sha256 === uploaded.sha256).length, 1);
  assert.equal(s.remote.disk().cloudRestore, undefined);
});
