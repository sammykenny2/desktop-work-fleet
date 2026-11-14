import test from 'node:test';
import assert from 'node:assert/strict';
import { copy, eligible, stableCards } from '../src/core/contracts.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController, idleInteraction, sceneOrder } from '../src/interaction/controller.js';
import { planFormation } from '../src/layout/formation.js';
import { visualOrder } from '../src/layout/stacking.js';
import { projectDesktop } from '../src/desktop/projection.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { unpackZip } from '../src/backup/archive.js';
import { prepareRestore } from '../src/backup/restore.js';

const area = { x: 0, y: 0, width: 1600, height: 1200 };
const content = text => ({ text, format: 'markdown', attachments: [] });
const sequence = f => {
  const layout = f.combined.layout.state;
  return visualOrder(f.combined.working.cards.filter(card => eligible(card, layout)), layout).map(card => card.id);
};
const controller = f => new InteractionController({ layout: f.combined.layout, getSnapshot: () => f.combined.working,
  commands: f.combined, saveDraft: async () => {}, workAreas: () => [area] });
async function fixture(records = new MemoryRecordStore(), seed = true) {
  const profiles = [];
  for (const id of ['local', 'google:account']) {
    const storage = new WorkspaceRecordStorage(records, id), saved = await storage.load(id);
    const persist = (...args) => storage.save(...args);
    const workspace = saved ? new Workspace(saved, persist, undefined, undefined, { history: storage })
      : await Workspace.create({ profileId: id, deviceId: 'device', area, current: true, history: storage, persist });
    profiles.push({ id, storage, workspace });
  }
  const [local, cloud] = profiles, combined = await CombinedWorkspace.open(profiles);
  const a = local.workspace.snapshot.groups[0], b = cloud.workspace.snapshot.groups[0];
  let notes;
  if (seed) {
    notes = [];
    for (const [text, group] of [['a1', a], ['b1', b], ['a2', a], ['b2', b]]) notes.push(await combined.createCard(content(text), group.id));
    await combined.layout.configure({ grid: { rows: 1, columns: 2, area, slots: [a.id, b.id] } }, combined.snapshot);
    await combined.layout.placeNew(combined.working, [area]);
    for (const note of notes) await combined.layout.raise([note.id]);
  } else notes = ['a1', 'b1', 'a2', 'b2'].map(text => combined.snapshot.cards.find(card => card.content.text === text));
  return { records, profiles, local, cloud, combined, a, b, notes };
}
const formation = (f, scope = { kind: 'all' }, mode = 'stack') => {
  const layout = f.combined.layout.state;
  return planFormation({ snapshot: f.combined.working, layout, scope, mode, workAreas: [area],
    summaryBands: Object.fromEntries(Object.keys(layout.placements).map(id => [id, 36])) });
};

test('Z01/Z02/Z03/Z16: ordinary attention and group entry persist across Done, sign-out and record-store reopen', async () => {
  const f = await fixture(), c = controller(f), [a1, b1, a2, b2] = f.notes;
  const oldGeometry = copy(f.combined.layout.state.placements), pending = f.combined.pendingCount;
  await c.activate({ kind: 'group', groupId: f.a.id }); assert.deepEqual(sequence(f), [b1.id, b2.id, a1.id, a2.id]);
  await c.select(a1.id); await c.activate({ kind: 'none' });
  assert.deepEqual(sequence(f), [b1.id, b2.id, a2.id, a1.id]);
  await c.activate({ kind: 'all' }); await c.select(b1.id); await c.activate({ kind: 'none' });
  const expected = [b2.id, a2.id, a1.id, b1.id]; assert.deepEqual(sequence(f), expected);
  assert.equal(f.combined.pendingCount, pending);
  for (const [id, rect] of Object.entries(oldGeometry)) assert.deepEqual({ ...f.combined.layout.state.placements[id], zOrder: rect.zOrder }, rect);
  assert.ok(f.profiles.every(profile => profile.workspace.layout.state.history.length === 0));
  const signedOut = await CombinedWorkspace.open([f.local]);
  assert.deepEqual(visualOrder(f.local.workspace.working.cards, signedOut.layout.state).map(card => card.id), [a2.id, a1.id]);
  const reopened = await fixture(f.records, false); assert.deepEqual(sequence(reopened), expected);
  const frame = projectDesktop({ snapshot: reopened.combined.working, layout: reopened.combined.layout.state,
    interaction: idleInteraction(), sessionId: 'test', sequence: 1, workspaceRevision: 1 });
  assert.deepEqual(frame.cards.map(card => card.id), expected); assert.equal(frame.operationScope.kind, 'none');
});

test('Z04/Z06/Z07: cancel writes nothing; successful return-to-origin drag saves only order and one Undo', async () => {
  const f = await fixture(), c = controller(f), [a1] = f.notes;
  await c.activate({ kind: 'all' }); const before = f.combined.layout.state, writes = f.records.stats.writes;
  c.pointerDown(a1.id, { x: 30, y: 30 }); c.pointerMove({ x: 100, y: 100 }); c.cancelDrag();
  assert.deepEqual(f.combined.layout.state, before); assert.equal(f.records.stats.writes, writes);
  c.pointerDown(a1.id, { x: 30, y: 30 }); c.pointerMove({ x: 100, y: 100 });
  await c.pointerUp({ x: 30, y: 30 });
  assert.equal(sequence(f).at(-1), a1.id);
  assert.deepEqual({ ...f.combined.layout.state.placements[a1.id], zOrder: before.placements[a1.id].zOrder }, before.placements[a1.id]);
  assert.deepEqual(f.local.workspace.layout.state.history.map(entry => entry.kind), ['move']);
  await f.combined.undo([area]); assert.deepEqual(f.combined.layout.state.placements[a1.id], before.placements[a1.id]);
  // Repeating a frontmost attention command is a true no-op, including its counter/control writes.
  const front = sequence(f).at(-1), stableWrites = f.records.stats.writes;
  await f.combined.layout.raise([front]); assert.equal(f.records.stats.writes, stableWrites);
});

test('Z12: Undo restores an operation but preserves newer attention, including attention on the moved paper', async () => {
  const f = await fixture(), c = controller(f), [a1, b1, a2] = f.notes;
  await c.activate({ kind: 'all' }); const origin = f.combined.layout.state.placements[a1.id];
  await f.combined.layout.move(a1.id, { x: 800, y: 600 }); await c.select(b1.id);
  await f.combined.undo([area]); assert.equal(sequence(f).at(-1), b1.id);
  assert.deepEqual(f.combined.layout.state.placements[a1.id], origin);
  await f.combined.layout.move(a1.id, { x: 900, y: 700 }); await c.select(a2.id); await c.select(a1.id);
  const raised = f.combined.layout.state.placements[a1.id].zOrder;
  await f.combined.undo([area]);
  assert.deepEqual(f.combined.layout.state.placements[a1.id], { ...origin, zOrder: raised });
  assert.equal(sceneOrder(f.combined.working.cards, f.combined.layout.state, c.state).at(-1).id, a1.id);
});

test('Z08/Z09/Z11: formation order is stable while visual promotions do not change cycle navigation', async () => {
  const f = await fixture(), c = controller(f);
  for (const text of ['a3', 'a4']) await f.combined.createCard(content(text), f.a.id);
  await f.combined.layout.placeNew(f.combined.working, [area]); await c.activate({ kind: 'all' });
  const stable = stableCards(f.combined.working.cards.filter(card => card.groupId === f.a.id), f.combined.layout.state).map(card => card.id);
  const visited = [];
  for (let i = 0; i < stable.length; i++) { await c.cycle(f.a.id); visited.push(c.state.selectedCardId); }
  assert.deepEqual(visited, stable);
  for (let i = stable.length - 2; i >= 0; i--) { await c.cycle(f.a.id, -1); assert.equal(c.state.selectedCardId, stable[i]); }
  await c.applyFormation(formation(f, { kind: 'group', groupId: f.a.id }));
  assert.deepEqual(sequence(f).slice(-stable.length), stable);
  await c.applyFormation(formation(f)); const arranged = sequence(f);
  await c.applyFormation(formation(f)); assert.deepEqual(sequence(f), arranged);
  assert.deepEqual(arranged.slice(0, stable.length), stable);
});

test('Z10: Reset is one recoverable placement operation, deterministic by region and creation order, retaining size choice', async () => {
  const f = await fixture();
  await f.combined.layout.configure({ newPaperSize: 'large' }, f.combined.snapshot);
  await f.combined.layout.reset(f.combined.snapshot, area, 'wallpaper'); const first = sequence(f);
  assert.equal(f.combined.layout.state.newPaperSize, 'large');
  for (const rect of Object.values(f.combined.layout.state.placements)) assert.deepEqual([rect.width, rect.height], [320, 320]);
  assert.ok(f.profiles.every(profile => profile.workspace.layout.state.history.length === 0));
  await f.combined.layout.raise([first[0]]); await f.combined.layout.reset(f.combined.snapshot, area, 'wallpaper');
  assert.deepEqual(sequence(f), first); assert.equal((await f.local.storage.getControl('desktop-layout-batch')).status, 'done');
  const reopened = await fixture(f.records, false); assert.deepEqual(sequence(reopened), first);
});

test('Z13/Z22: interrupted multi-profile formation remains visually unchanged, then resumes exactly once after reopen', async () => {
  const f = await fixture(), before = f.combined.layout.state, original = f.records.commit.bind(f.records);
  let fail = true;
  f.records.commit = async (transaction, ...args) => {
    if (fail && transaction.profileId === f.cloud.id && transaction.puts.some(row => row.collection === 'meta'
      && row.key.endsWith(':layout') && row.value.layoutBatchId)) throw new Error('second owner unavailable');
    return original(transaction, ...args);
  };
  await assert.rejects(f.combined.layout.applyFormation(formation(f), () => f.combined.working), /unavailable/);
  assert.deepEqual(f.combined.layout.state.placements, before.placements, 'no half-applied scene is published');
  assert.equal((await f.local.storage.getControl('desktop-layout-batch')).status, 'pending');
  await f.local.workspace.createCard(content('capture still works'), f.a.id);
  fail = false; const reopened = await fixture(f.records, false);
  assert.equal((await reopened.local.storage.getControl('desktop-layout-batch')).status, 'done');
  const revisions = reopened.profiles.map(profile => profile.workspace.layout.state.revision);
  await reopened.combined.layout.recoverBatch();
  assert.deepEqual(reopened.profiles.map(profile => profile.workspace.layout.state.revision), revisions);
  assert.ok(reopened.local.workspace.snapshot.cards.some(card => card.content.text === 'capture still works'));
});

test('Z13: interrupted batch Undo resumes without undoing a profile twice', async () => {
  const f = await fixture(), before = copy(f.combined.layout.state.placements);
  await f.combined.layout.applyFormation(formation(f), () => f.combined.working);
  const original = f.records.commit.bind(f.records); let fail = true;
  f.records.commit = async (transaction, ...args) => {
    if (fail && transaction.profileId === f.cloud.id && transaction.puts.some(row => row.collection === 'meta'
      && row.key.endsWith(':layout') && row.value.history.length === 0 && row.value.layoutBatchId)) throw new Error('Undo interrupted');
    return original(transaction, ...args);
  };
  await assert.rejects(f.combined.undo([area]), /interrupted/); fail = false;
  const reopened = await fixture(f.records, false);
  assert.deepEqual(reopened.combined.layout.state.placements, before);
  assert.ok(reopened.profiles.every(profile => profile.workspace.layout.state.history.length === 0));
});

test('Z10/Z13: Reset interrupted before another owner commits preserves its visible layout and resumes its selected size', async () => {
  const f = await fixture(); await f.combined.layout.configure({ newPaperSize: 'small' }, f.combined.snapshot);
  const before = f.combined.layout.state, original = f.records.commit.bind(f.records); let fail = true;
  f.records.commit = async (transaction, ...args) => {
    if (fail && transaction.profileId === f.cloud.id && transaction.puts.some(row => row.collection === 'meta'
      && row.key.endsWith(':layout') && row.value.layoutBatchId)) throw new Error('Reset interrupted');
    return original(transaction, ...args);
  };
  await assert.rejects(f.combined.layout.reset(f.combined.snapshot, area, 'wallpaper'), /interrupted/);
  assert.deepEqual(f.combined.layout.state.grid, before.grid); assert.deepEqual(f.combined.layout.state.placements, before.placements);
  fail = false; const reopened = await fixture(f.records, false);
  assert.deepEqual([reopened.combined.layout.state.grid.rows, reopened.combined.layout.state.grid.columns], [2, 3]);
  assert.ok(Object.values(reopened.combined.layout.state.placements).every(rect => rect.width === 160 && rect.height === 160));
  assert.equal(reopened.combined.layout.state.newPaperSize, 'small');
});

test('Z22: the local counter must acknowledge reservations even when a cloud replica accepted them', async () => {
  const f = await fixture(), before = f.combined.layout.state, put = f.local.storage.putControl.bind(f.local.storage);
  let fail = true;
  f.local.storage.putControl = async (key, value) => { if (fail && key === 'desk') throw new Error('device counter unavailable'); return put(key, value); };
  await assert.rejects(f.combined.layout.raise([f.notes[0].id]), /counter unavailable/);
  assert.deepEqual(f.combined.layout.state.placements, before.placements);
  const reserved = (await f.cloud.storage.getControl('desk')).zOrderCounter;
  fail = false; const reopened = await fixture(f.records, false);
  await reopened.combined.layout.raise([f.notes[0].id]);
  assert.ok(reopened.combined.layout.state.placements[f.notes[0].id].zOrder > reserved);
});

test('Z22: a newer desk preference never discards an older replica with a higher high-water mark', async () => {
  const f = await fixture(), before = await f.cloud.storage.getControl('desk');
  const high = '00000000000000000000000000001000';
  await f.cloud.storage.putControl('desk', { ...before, revision: 0, changedAt: 0, zOrderCounter: high, desktopVisible: false });
  const reopened = await fixture(f.records, false);
  assert.equal(reopened.combined.layout.state.desktopVisible, true);
  await reopened.combined.layout.raise([f.notes[0].id]);
  assert.ok(reopened.combined.layout.state.placements[f.notes[0].id].zOrder > high);
});

test('Z23: purge while a batch is incomplete cannot be overwritten by journal recovery', async () => {
  const f = await fixture(), original = f.records.commit.bind(f.records); let fail = true;
  f.records.commit = async (transaction, ...args) => {
    if (fail && transaction.profileId === f.cloud.id && transaction.puts.some(row => row.collection === 'meta'
      && row.key.endsWith(':layout') && row.value.layoutBatchId)) throw new Error('apply interrupted');
    return original(transaction, ...args);
  };
  await assert.rejects(f.combined.layout.applyFormation(formation(f), () => f.combined.working)); fail = false;
  const removed = f.notes[1].id;
  await f.cloud.workspace.applyPermanentDeletion([{ entityId: removed, operationId: crypto.randomUUID() }]);
  await assert.rejects(f.combined.layout.recoverBatch(), { code: 'stale-layout-batch' });
  assert.equal(f.cloud.workspace.holdsCard(removed), false);
  assert.equal(f.combined.layout.state.placements[removed], undefined);
  assert.equal((await f.local.storage.getControl('desktop-layout-batch')).status, 'abandoned');
  await f.combined.layout.raise([f.notes[0].id]); assert.equal(sequence(f).at(-1), f.notes[0].id);
});

test('Z14/Z15: saved order is projected after native layer fallback, never changing resident layers', async () => {
  const f = await fixture(), [a1] = f.notes;
  await f.combined.layout.setGroupLayer(f.a.id, 'desktop'); await f.combined.layout.setGroupLayer(f.b.id, 'floating');
  await f.combined.layout.raise([a1.id]);
  const options = { snapshot: f.combined.working, layout: f.combined.layout.state, interaction: idleInteraction(),
    sessionId: 'test', sequence: 1, workspaceRevision: 1 };
  const frame = projectDesktop(options);
  assert.equal(frame.cards.find(card => card.id === a1.id).layer, 'desktop');
  const fallback = projectDesktop({ ...options, layers: ['desktop'], residentLayers: ['desktop'] });
  assert.equal(fallback.cards.at(-1).id, a1.id); assert.ok(fallback.fallbacks.every(item => item.effective === 'desktop'));
  assert.equal(f.combined.layout.state.groupLayers[f.b.id], 'floating');
});

test('Z20/M02: actual ZIP retains owned order and rebases adoption without foreign IDs, counters or changed original bytes', async () => {
  const source = await fixture(), target = await fixture();
  await source.combined.layout.raise([source.notes[0].id]);
  const { bytes } = await createBackup({ workspace: source.local.workspace, storage: source.local.storage, coverage: 'current-state-only' });
  const original = new Uint8Array(bytes), files = await unpackZip(bytes), text = [...files.values()].map(value => new TextDecoder().decode(value)).join('');
  assert.equal(text.includes('zOrderCounter'), false); assert.equal(text.includes('layoutBatchId'), false);
  for (const card of source.cloud.workspace.snapshot.cards) assert.equal(text.includes(card.id), false);
  const oldForeign = sequence(target).filter(id => target.cloud.workspace.holdsCard(id));
  const document = await openBackup(bytes);
  const oldOwned = copy(target.local.workspace.layout.state.placements);
  const plan = await prepareRestore({ workspace: target.local.workspace, document, mode: 'import', layout: 'backup', workAreas: [area], placeLater: true });
  const receipt = await target.local.workspace.applyRestore(plan, { persist: (state, revision, attachments, detail) => target.local.storage.saveWithAttachments(state, revision, attachments, detail) });
  const expected = visualOrder(source.local.workspace.snapshot.cards, source.local.workspace.layout.state).map(card => receipt.mappings.card[card.id]);
  assert.deepEqual(sequence(target).slice(-expected.length), expected);
  assert.deepEqual(sequence(target).filter(id => target.cloud.workspace.holdsCard(id)), oldForeign);
  for (const [id, rect] of Object.entries(oldOwned)) assert.deepEqual(target.local.workspace.layout.state.placements[id], rect);
  assert.deepEqual(bytes, original);
});

test('Z21/M01/M06: an installed pre-label V1 record layout and its backup open without a bulk rewrite or content loss', async () => {
  const source = await fixture(); const draft = source.local.workspace.openDraft(source.a.id, source.notes[0]);
  draft.content.text = 'unsaved tester text'; await source.local.workspace.saveDraft(draft);
  const old = source.local.workspace.state; old.revision = 0; old.extension = { keep: 'tester extension' };
  delete old.layout.zOrderCounter; delete old.layout.layoutBatchId;
  for (const rect of Object.values(old.layout.placements)) delete rect.zOrder;
  old.layout.history = [];
  const records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'local');
  await storage.save(old, null); const writes = records.stats.writes;
  const installed = new Workspace(await storage.load('local'), (...args) => storage.save(...args), undefined, undefined, { history: storage });
  assert.equal(records.stats.writes, writes); assert.deepEqual(installed.state.extension, old.extension);
  assert.equal(installed.unsavedChanges(source.notes[0].id).content.text, 'unsaved tester text');
  const legacyOrder = visualOrder(installed.working.cards, installed.layout.state).map(card => card.id);
  const backup = await createBackup({ workspace: installed, storage, coverage: 'current-state-only' });
  const document = await openBackup(backup.bytes);
  assert.ok(document.data.layout.placements[source.notes[0].id].zOrder === undefined);
  const target = await fixture(), unchanged = new Uint8Array(backup.bytes);
  const plan = await prepareRestore({ workspace: target.local.workspace, document, mode: 'import', layout: 'backup', workAreas: [area], placeLater: true });
  const receipt = await target.local.workspace.applyRestore(plan, { persist: (state, revision, attachments, detail) => target.local.storage.saveWithAttachments(state, revision, attachments, detail) });
  for (const card of old.cards) {
    const adopted = target.local.workspace.cardValue(receipt.mappings.card[card.id]);
    assert.deepEqual(adopted.content, card.content);
  }
  assert.deepEqual(backup.bytes, unchanged);
  await installed.layout.raise([legacyOrder[0]]);
  const fresh = new WorkspaceRecordStorage(records, 'local'), after = await fresh.load('local');
  assert.deepEqual(new Map(after.cards.map(card => [card.id, card])), new Map(old.cards.map(card => [card.id, card])));
  assert.deepEqual(after.extension, old.extension);
  assert.equal(after.drafts[draft.id].content.text, 'unsaved tester text');
  assert.equal(visualOrder(installed.working.cards, after.layout).at(-1).id, legacyOrder[0]);
});
