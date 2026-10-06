import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy } from '../src/core/contracts.js';
import { revisionRecord } from '../src/sources/revisions.js';
import { canonicalJson, parseJson } from '../src/sources/json.js';
import { sha256 } from '../src/sources/files.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { prepareRestore, RestorePlan, saveSafetyBackup, SafetyBackupReceipt } from '../src/backup/restore.js';
import { LayoutStore } from '../src/layout/store.js';
import { backupScheduler, packZip, unpackZip } from '../src/backup/archive.js';

const area = { x: 0, y: 0, width: 1400, height: 900 };
const fails = code => error => error.code === code;
const text = value => ({ format: 'markdown', text: value, attachments: [], extra: { retained: true } });

async function fixture(initial = null, sourceBlobs = new Map()) {
  let disk = initial ? copy(initial) : null; const blobs = new Map(sourceBlobs); let writes = 0; let fail = false;
  const persist = async (state, previous) => {
    assert.equal(disk?.revision ?? null, previous); disk = copy(state); writes++;
  };
  const workspace = initial ? new Workspace(initial, persist) : await Workspace.create({ profileId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(), area, persist });
  const storage = { getAttachment: async (profile, id) => {
    assert.equal(profile, workspace.state.profileId); return blobs.has(id) ? new Blob([blobs.get(id)]) : null;
  } };
  const atomic = async (state, previous, attachments) => {
    assert.equal(disk.revision, previous);
    if (fail) throw new Error('injected transaction abort');
    const pending = new Map(blobs); for (const { id, bytes } of attachments) {
      assert.equal(await sha256(bytes), id); pending.set(id, bytes.slice());
    }
    disk = copy(state); blobs.clear(); for (const [id, bytes] of pending) blobs.set(id, bytes); writes++;
  };
  return { workspace, storage, blobs, persist, atomic, disk: () => copy(disk), writes: () => writes,
    fail: value => { fail = value; }, export: async () => openBackup((await createBackup({ workspace, storage })).bytes) };
}

async function source() {
  const f = await fixture(); const a = f.workspace.snapshot.groups[0]; const b = await f.workspace.createGroup('B');
  const bytes = new TextEncoder().encode('附件 中文 💡 <svg onload="x()">'); const id = await sha256(bytes); f.blobs.set(id, bytes);
  let card = await f.workspace.createCard({ ...text('原始中文 💡\n- [ ] 工作'), attachments: [{ id, name: 'file.svg', size: bytes.length }] }, a.id);
  card = await f.workspace.updateCard(card.id, { completed: true, archived: true }, card.revision);
  const deleted = await f.workspace.createCard(text('可恢復刪除'), b.id);
  await f.workspace.updateCard(deleted.id, { deleted: true }, deleted.revision);
  await f.workspace.layout.placeNew(f.workspace.snapshot, [area]);
  await f.workspace.layout.setGroupLayer(a.id, 'wallpaper', f.workspace.snapshot);
  const draft = f.workspace.blankDraft(a.id, card); draft.content.text = '未保存草稿'; await f.workspace.saveDraft(draft);
  const recovered = f.workspace.recoverDraft(draft.id); recovered.content.text = '恢復草稿'; await f.workspace.saveDraft(recovered);
  return { ...f, a, b, card, deleted, draft, recovered, id, bytes };
}

test('import preview is read-only; commit maps complete identities and atomically retains existing data, attachments and layout', async () => {
  const s = await source(); const document = await s.export(); const target = await fixture();
  const existing = await target.workspace.createCard(text('keep existing')); await target.workspace.layout.placeNew(target.workspace.snapshot, [area]);
  const before = target.disk(); const writes = target.writes();
  const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'import', layout: 'backup', workAreas: [area] });
  assert.ok(plan instanceof RestorePlan); assert.deepEqual(target.disk(), before); assert.equal(target.writes(), writes);
  assert.equal(target.blobs.size, 0); const preview = plan.preview; preview.addedRevisions = -1;
  assert.equal(plan.preview.addedRevisions, s.disk().revisions.length);
  const receipt = await target.workspace.applyRestore(plan, { persist: target.atomic }); const after = target.disk();
  assert.equal(target.writes(), writes + 1); assert.equal(after.cards.length, before.cards.length + s.disk().cards.length);
  assert.deepEqual(after.cards.find(card => card.id === existing.id), before.cards.find(card => card.id === existing.id));
  assert.deepEqual(after.layout.placements[existing.id], before.layout.placements[existing.id]);
  const imported = after.cards.find(card => card.id === receipt.mappings.card[s.card.id]);
  assert.deepEqual(imported.content, s.card.content); assert.equal(imported.completed, true); assert.equal(imported.archived, true);
  assert.notEqual(imported.groupId, s.a.id); assert.equal(after.groups.find(group => group.id === imported.groupId).name, s.a.name);
  assert.deepEqual(target.blobs.get(s.id), s.bytes); assert.equal(after.layout.deviceId, before.layout.deviceId);
  assert.deepEqual(after.layout.placements[imported.id], s.disk().layout.placements[s.card.id]);
  assert.equal(after.outbox.length, before.outbox.length + s.disk().revisions.length);
  assert.deepEqual(after.restoreReceipts[receipt.jobId], receipt); assert.deepEqual(after.sync, before.sync);
  const recoveredId = receipt.mappings.draft[s.recovered.id]; const originalId = receipt.mappings.draft[s.draft.id];
  assert.equal(after.drafts[recoveredId].recoveredFrom[0].id, originalId);
  await target.workspace.commitDraft(recoveredId); assert.equal(target.workspace.state.drafts[originalId], undefined);
});

test('restore receipts make concurrent retry and reopening idempotent; an explicit repeat creates another import', async () => {
  const s = await source(); const document = await s.export(); const target = await fixture();
  const plan = await prepareRestore({ workspace: target.workspace, document, workAreas: [area] }); const writes = target.writes();
  const results = await Promise.all([target.workspace.applyRestore(plan, { persist: target.atomic }), target.workspace.applyRestore(plan, { persist: target.atomic })]);
  assert.deepEqual(results[0], results[1]); assert.equal(target.writes(), writes + 1);
  const reopened = new Workspace(target.disk(), target.persist);
  assert.deepEqual(await reopened.applyRestore(plan, { persist: target.atomic }), results[0]); assert.equal(target.writes(), writes + 1);
  await assert.rejects(prepareRestore({ workspace: reopened, document, workAreas: [area] }), fails('already-restored'));
  const repeat = await prepareRestore({ workspace: reopened, document, workAreas: [area], repeat: true });
  await reopened.applyRestore(repeat, { persist: target.atomic }); assert.equal(reopened.snapshot.cards.length, s.workspace.snapshot.cards.length * 2);
});

test('transaction failure rolls back state, graph, layout, receipts and attachment publication; the identical plan can retry', async () => {
  const s = await source(); const target = await fixture();
  const plan = await prepareRestore({ workspace: target.workspace, document: await s.export(), workAreas: [area], layout: 'backup' });
  const before = target.disk(); target.fail(true);
  await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic }), /transaction abort/);
  assert.deepEqual(target.disk(), before); assert.deepEqual(target.workspace.state, before); assert.deepEqual(target.workspace.layout.state, before.layout);
  assert.equal(target.blobs.size, 0); assert.equal(target.workspace.revisionHeads('card', plan.receipt.mappings.card[s.card.id]).length, 0);
  target.fail(false); await target.workspace.applyRestore(plan, { persist: target.atomic });
  assert.equal(target.workspace.revisionHeads('card', plan.receipt.mappings.card[s.card.id]).length, 1);
});

test('stale plans, changed profiles, cancelled work and caller-created plans cannot write', async () => {
  const s = await source(); const document = await s.export(); const target = await fixture();
  const plan = await prepareRestore({ workspace: target.workspace, document, workAreas: [area] });
  await target.workspace.createCard(text('after preview')); const before = target.disk();
  await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic }), fails('stale-restore-plan'));
  assert.deepEqual(target.disk(), before);
  const another = await fixture(); await assert.rejects(another.workspace.applyRestore(plan, { persist: another.atomic }), fails('restore-profile'));
  assert.throws(() => new RestorePlan(), fails('invalid-restore-plan')); assert.throws(() => new SafetyBackupReceipt(), fails('invalid-safety-backup'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareRestore({ workspace: target.workspace, document, workAreas: [area], signal: controller.signal }), fails('backup-cancelled'));
  await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic, signal: controller.signal }), fails('backup-cancelled'));
});

test('merge keeps concurrent revision heads and separate draft edits, deduplicates immutable history and preserves current geometry', async () => {
  const s = await source(); const target = await fixture(s.disk(), s.blobs);
  const local = await target.workspace.updateCard(s.card.id, { content: { ...s.card.content, text: 'local branch' } }, s.card.revision);
  const changed = copy(s.draft); changed.content.text = 'target independent draft'; await target.workspace.saveDraft(changed);
  await target.workspace.layout.move(s.card.id, { x: 500, y: 250 }, target.workspace.layout.state.revision);
  await s.workspace.updateCard(s.card.id, { content: { ...s.card.content, text: 'backup branch' } }, s.card.revision);
  const document = await s.export(); const before = target.disk();
  const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'merge', workAreas: [area] });
  await target.workspace.applyRestore(plan, { persist: target.atomic });
  const after = target.disk(); assert.equal(after.cards.length, before.cards.length);
  assert.equal(after.revisions.length, before.revisions.length + 1); assert.equal(after.outbox.length, before.outbox.length + 1);
  assert.deepEqual(after.layout.placements, before.layout.placements); assert.equal(after.cards.find(card => card.id === s.card.id).revision, local.revision);
  assert.equal(target.workspace.revisionHeads('card', s.card.id).length, 2);
  assert.equal(after.drafts[s.draft.id].content.text, changed.content.text);
  const restoredId = plan.receipt.mappings.restoredDrafts[s.draft.id]; assert.notEqual(restoredId, s.draft.id);
  const recoveredId = plan.receipt.mappings.restoredDrafts[s.recovered.id]; assert.notEqual(recoveredId, s.recovered.id);
  assert.equal(after.drafts[recoveredId].recoveredFrom[0].id, restoredId);
  assert.equal(parseJson(after.drafts[recoveredId].recoveredFrom[0].baseline).id, restoredId);
  assert.equal(after.drafts[restoredId].content.text, s.draft.content.text);
});

test('same revision ID with different bytes rejects merge before any writes', async () => {
  const s = await source(); const target = await fixture(s.disk(), s.blobs); const bad = s.disk();
  bad.revisions.find(record => record.revisionId === s.card.revision).value.content.text = 'different immutable contents';
  const document = await openBackup((await createBackup({ workspace: { state: bad }, storage: s.storage })).bytes);
  const before = target.disk(); await assert.rejects(prepareRestore({ workspace: target.workspace, document, mode: 'merge', workAreas: [area] }), fails('revision-collision'));
  assert.deepEqual(target.disk(), before);
});

test('replace needs a saved safety backup, appends all-head revisions, retires extra groups and preserves later history and both drafts', async () => {
  const s = await source(); const document = await s.export(); const target = await fixture(s.disk(), s.blobs);
  const later = await target.workspace.updateCard(s.card.id, { content: { ...s.card.content, text: 'later target text' } }, s.card.revision);
  const extraGroup = await target.workspace.createGroup('extra'); const extra = await target.workspace.createCard(text('extra card'), extraGroup.id);
  const before = target.disk(); const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'replace', layout: 'backup', workAreas: [area] });
  await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic }), fails('missing-safety-backup'));
  await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic, safetyBackup: { binding: { profileId: before.profileId, revision: before.revision } } }), fails('missing-safety-backup'));
  assert.deepEqual(target.disk(), before);
  let saved;
  const safetyBackup = await saveSafetyBackup({ workspace: target.workspace, storage: target.storage,
    save: async ({ bytes }) => { saved = await openBackup(bytes); return { saved: true, receipt: 'verified-test-file' }; } });
  assert.deepEqual(saved.data.records, before.revisions);
  await target.workspace.applyRestore(plan, { persist: target.atomic, safetyBackup }); const after = target.disk();
  const restored = after.cards.find(card => card.id === s.card.id);
  assert.deepEqual(restored.content, s.card.content); assert.notEqual(restored.revision, s.card.revision);
  const version = after.revisions.find(record => record.revisionId === restored.revision);
  assert.ok(version.parents.includes(later.revision)); assert.ok(version.parents.includes(s.card.revision));
  assert.ok(after.revisions.some(record => record.revisionId === later.revision && record.value.content.text === 'later target text'));
  assert.equal(after.cards.find(card => card.id === extra.id).deleted, true);
  assert.equal(after.groups.find(group => group.id === extraGroup.id).deleted, true);
  assert.deepEqual(after.drafts[s.draft.id], before.drafts[s.draft.id]);
  assert.equal(after.drafts[plan.receipt.mappings.restoredDrafts[s.draft.id]].baseRevision, restored.revision);
  // The next backup must still pass all rebase and reference proofs after replacement.
  await target.export();
});

test('safety save cancellation or failure cannot authorize replace, and an old successful receipt cannot authorize a newer state', async () => {
  const s = await source(); const target = await fixture(s.disk(), s.blobs); const document = await s.export();
  await assert.rejects(saveSafetyBackup({ workspace: target.workspace, storage: target.storage, save: async () => ({ saved: false }) }), fails('backup-not-saved'));
  await assert.rejects(saveSafetyBackup({ workspace: target.workspace, storage: target.storage, save: async () => { throw new Error('disk full'); } }), /disk full/);
  const controller = new AbortController();
  const completed = await saveSafetyBackup({ workspace: target.workspace, storage: target.storage, signal: controller.signal,
    save: async () => { controller.abort(); return { saved: true, receipt: 'already-closed-and-verified' }; } });
  assert.equal(completed.binding.revision, target.disk().revision, 'a late abort cannot revoke the actual completed file save');
  const safetyBackup = await saveSafetyBackup({ workspace: target.workspace, storage: target.storage, save: async () => ({ saved: true, receipt: 'saved' }) });
  await target.workspace.createCard(text('new after safety copy'));
  const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'replace', workAreas: [area] });
  const before = target.disk(); await assert.rejects(target.workspace.applyRestore(plan, { persist: target.atomic, safetyBackup }), fails('missing-safety-backup'));
  assert.deepEqual(target.disk(), before);
});

test('import retains pending dependencies under remapped IDs without inventing ancestors', async () => {
  const s = await source(); const session = await s.workspace.beginSync('synthetic-source');
  const pending = revisionRecord('card', { ...s.card, id: 'pending-card', revision: 'pending-child' }, ['missing-parent']);
  await s.workspace.receiveRevisions([pending], { session, expectedCursor: null, cursor: 'cursor' });
  const target = await fixture(); const plan = await prepareRestore({ workspace: target.workspace, document: await s.export(), workAreas: [area] });
  assert.equal(plan.preview.result.pendingRevisions, 1); await target.workspace.applyRestore(plan, { persist: target.atomic });
  const ids = plan.receipt.mappings.revision; const record = target.disk().revisions.find(item => item.revisionId === ids['pending-child']);
  assert.deepEqual(record.parents, [ids['missing-parent']]); assert.notEqual(ids['missing-parent'], 'missing-parent');
  assert.equal(target.disk().revisions.some(item => item.revisionId === ids['missing-parent']), false); await target.export();
});

test('cancelling bulk new-card placement rolls back partial geometry and releases the transaction queue', async () => {
  const target = await fixture(); const before = target.workspace.layout.state; let writes = 0;
  const layout = new LayoutStore(before, async () => { writes++; });
  const snapshot = target.workspace.snapshot;
  snapshot.cards = Array.from({ length: 10000 }, (_, index) => ({ id: `bulk-${index}`, groupId: snapshot.groups[0].id, deleted: false }));
  const controller = new AbortController(); const checkpoint = backupScheduler(controller.signal); let visited = 0;
  await assert.rejects(layout.placeNew(snapshot, [area], undefined, async () => {
    if (++visited === 100) await new Promise(resolve => setTimeout(() => { controller.abort(); resolve(); }, 0));
    await checkpoint();
  }), fails('backup-cancelled'));
  assert.equal(visited, 100); assert.equal(writes, 0); assert.deepEqual(layout.state, before);
  await layout.configure({ desktopVisible: false }, snapshot);
  assert.equal(writes, 1); assert.equal(layout.state.desktopVisible, false);
  assert.deepEqual(layout.state.placements, before.placements);
});

test('an older backup that bound keys to groups restores them as keys for the regions those groups hold', async () => {
  const s = await source();
  await s.workspace.layout.configure({ shortcuts: { 'Ctrl+Shift+1': s.b.id, 'Alt+F2': s.a.id, 'Ctrl+Shift+0': '@all' } }, s.workspace.snapshot);
  const document = await s.export(); const target = await fixture(s.disk(), s.blobs);
  const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'merge', layout: 'backup', workAreas: [area] });
  await target.workspace.applyRestore(plan, { persist: target.atomic }); const { layout } = target.disk();
  assert.equal(layout.shortcuts['Ctrl+Shift+1'], `@region${layout.grid.slots.indexOf(s.b.id) + 1}`);
  assert.equal(layout.shortcuts['Alt+F2'], `@region${layout.grid.slots.indexOf(s.a.id) + 1}`);
  assert.equal(layout.shortcuts['Ctrl+Shift+0'], '@all');
  assert.ok(Object.values(layout.shortcuts).every(value => value.startsWith('@')), 'no key stays bound to a group id');
});

test('an older backup that kept a layer on each paper restores as the lowest layer of each group', async () => {
  const s = await source(); const shown = [await s.workspace.createCard(text('桌面上'), s.a.id), await s.workspace.createCard(text('也在桌面上'), s.a.id)];
  await s.workspace.layout.placeNew(s.workspace.snapshot, [area]); const target = await fixture(s.disk(), s.blobs);
  const files = await unpackZip((await createBackup({ workspace: s.workspace, storage: s.storage })).bytes);
  const manifest = parseJson(files.get('manifest.json')); const layout = parseJson(files.get('layout.json'));
  delete layout.groupLayers;
  for (const [id, rect] of Object.entries(layout.placements)) Object.assign(rect, { residentLayer: shown.some(card => card.id === id) ? 'floating' : 'wallpaper', readOnlySelect: true });
  const bytes = new TextEncoder().encode(canonicalJson(layout)); files.set('layout.json', bytes);
  const entry = manifest.files.find(file => file.name === 'layout.json'); Object.assign(entry, { size: bytes.length, sha256: await sha256(bytes) });
  files.set('manifest.json', new TextEncoder().encode(canonicalJson(manifest)));
  const document = await openBackup(await packZip(files));
  const plan = await prepareRestore({ workspace: target.workspace, document, mode: 'merge', layout: 'backup', workAreas: [area] });
  await target.workspace.applyRestore(plan, { persist: target.atomic }); const after = target.disk().layout;
  // The archived and deleted papers sit on the wallpaper but do not count, so group A takes its shown papers' layer.
  assert.deepEqual(after.groupLayers, { [s.a.id]: 'floating' });
  assert.ok(Object.values(after.placements).every(rect => !('residentLayer' in rect) && !('readOnlySelect' in rect)));
});
