import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups } from '../src/core/contracts.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { CrossMove } from '../src/core/cross-move.js';
import { InteractionController } from '../src/interaction/controller.js';
import { Workspace } from '../src/core/workspace.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { revisionRecord } from '../src/sources/revisions.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });
const SECTIONS = ['google:cloud', 'local'];

async function open() {
  const profiles = []; const records = new MemoryRecordStore();
  for (const id of SECTIONS) {
    const storage = new WorkspaceRecordStorage(records, id);
    const workspace = await Workspace.create({ profileId: id, deviceId: 'device', area, current: true, history: storage, bootstrapGroup: false, persist: (...args) => storage.save(...args) });
    profiles.push({ id, workspace, storage });
  }
  const combined = await CombinedWorkspace.open(profiles);
  const groups = {}; for (const profile of profiles) groups[profile.id] = await combined.createGroup(profile.id === 'local' ? 'Home' : 'Work', profile.id);
  await combined.layout.placeNew(combined.working, [area]);
  return { combined, profiles, groups, profile: id => profiles.find(item => item.id === id), move: new CrossMove(combined) };
}
const receive = async (workspace, records, cursor) => {
  const session = await workspace.beginSync('other-device'); const expectedCursor = workspace.syncState.cursor;
  await workspace.receiveRevisions(records, { session, expectedCursor, cursor });
  await workspace.endSync(session);
};
// A device signed in to the same synthetic Drive, past its first sync.
const device = async provider => {
  const profileId = 'google:test'; const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), profileId);
  const workspace = await Workspace.create({ profileId, deviceId: crypto.randomUUID(), area, persist: (...args) => storage.save(...args), current: true, bootstrapGroup: false, history: storage });
  const sync = new DatasetSync({ workspace, storage, fileStore: provider }); await sync.sync();
  return { workspace, sync };
};
const counts = ({ notes, unsaved }) => ({ notes, unsaved });
const notesOf = (workspace, groupId) => workspace.snapshot.cards.filter(card => card.groupId === groupId);

// The rules are the same in every section, so each test of them runs in both.
for (const id of SECTIONS) {
  test(`${id}: the last group can be deleted, its notes wait in Trash and nothing makes a new group`, async () => {
    const f = await open(); const { workspace, storage } = f.profile(id); const group = f.groups[id];
    const other = SECTIONS.find(item => item !== id);
    const active = await f.combined.createCard(content('active'), group.id);
    const completed = await f.combined.createCard(content('completed'), group.id);
    await f.combined.updateCard(completed.id, { completed: true }, completed.revision);
    const archived = await f.combined.createCard(content('archived'), group.id);
    await f.combined.updateCard(archived.id, { archived: true }, archived.revision);
    const trashed = await f.combined.createCard(content('already in Trash'), group.id);
    const earlier = await f.combined.updateCard(trashed.id, { deleted: true }, trashed.revision);
    const elsewhere = await f.combined.createCard(content('in the other section'), f.groups[other].id);
    await f.combined.layout.placeNew(f.combined.working, [area]);

    assert.deepEqual(counts(f.combined.previewGroupDelete(group.id)), { notes: 3, unsaved: 0 });
    assert.deepEqual(await f.combined.deleteGroup(group.id), { notes: 3 });

    assert.deepEqual(activeGroups(workspace.snapshot), [], 'the section may hold no group');
    assert.ok(notesOf(workspace, group.id).every(card => card.deleted && card.trashedAt && card.trashEpisode), 'every note is in Trash');
    assert.equal(workspace.cardValue(trashed.id).trashEpisode, earlier.trashEpisode, 'a note already in Trash keeps its time there');
    assert.equal(workspace.cardValue(active.id).content.text, 'active', 'a note keeps its content');
    assert.equal(f.profile(other).workspace.cardValue(elsewhere.id).deleted, false, 'the other section is untouched');
    assert.ok(f.combined.groups().some(item => item.id === f.groups[other].id));
    assert.ok(!f.combined.layout.state.grid.slots.includes(group.id), 'the group gives up its region');

    // Reopening finds the section as it was left: no default group comes back.
    const reopened = new Workspace(await storage.load(id), async () => {}, undefined, undefined, { history: storage });
    assert.deepEqual(activeGroups(reopened.snapshot), []);
    await assert.rejects(workspace.createCard(content('nowhere to go'), group.id), { code: 'missing-group' });
  });

  test(`${id}: a note restored from a deleted group goes to another group, or brings the group back when there is none`, async () => {
    const f = await open(); const { workspace } = f.profile(id); const group = f.groups[id];
    const first = await f.combined.createCard(content('first'), group.id);
    const second = await f.combined.createCard(content('second'), group.id);
    await f.combined.deleteGroup(group.id);

    const other = await workspace.createGroup('Another');
    const moved = await workspace.restoreCard(first.id, workspace.cardValue(first.id).revision, other.id);
    assert.equal(moved.groupId, other.id); assert.equal(moved.deleted, false);
    assert.ok(!activeGroups(workspace.snapshot).some(item => item.id === group.id), 'restoring elsewhere leaves the deleted group gone');

    await f.combined.deleteGroup(other.id);
    assert.deepEqual(activeGroups(workspace.snapshot), []);
    const back = await workspace.restoreCard(second.id, workspace.cardValue(second.id).revision, null, { bringGroupBack: true });
    assert.equal(back.groupId, group.id);
    assert.deepEqual(activeGroups(workspace.snapshot).map(item => item.id), [group.id]);
  });

  test(`${id}: unsaved work is counted, goes with the group and does not keep it in sight`, async () => {
    const f = await open(); const { workspace } = f.profile(id); const group = f.groups[id];
    const note = await f.combined.createCard(content('saved'), group.id);
    const changed = workspace.blankDraft(group.id, note); changed.content.text = 'changed but unsaved'; await workspace.saveDraft(changed);
    const typed = workspace.blankDraft(group.id); typed.content.text = 'never saved'; await workspace.saveDraft(typed);
    await workspace.saveDraft(workspace.blankDraft(group.id));
    assert.deepEqual(counts(f.combined.previewGroupDelete(group.id)), { notes: 1, unsaved: 2 }, 'a blank new note holds nothing to lose');
    await f.combined.deleteGroup(group.id);
    assert.deepEqual(workspace.state.drafts, {});
    assert.deepEqual(activeGroups(workspace.snapshot), []);
    assert.equal(workspace.unsavedChanges(note.id), null);
  });

  test(`${id}: a failed write changes nothing`, async () => {
    const f = await open(); const { workspace, storage } = f.profile(id); const group = f.groups[id];
    const note = await f.combined.createCard(content('safe'), group.id);
    const save = storage.save; storage.save = async () => { throw new Error('disk full'); };
    await assert.rejects(f.combined.deleteGroup(group.id), /disk full/);
    storage.save = save;
    assert.equal(workspace.cardValue(note.id).deleted, false);
    assert.ok(activeGroups(workspace.snapshot).some(item => item.id === group.id));
    await f.combined.deleteGroup(group.id);
    assert.equal(workspace.cardValue(note.id).deleted, true);
  });
}

test('what followed a deleted group ends with it, and the other groups keep theirs', async () => {
  const f = await open(); const { workspace } = f.profile('local'); const group = f.groups.local;
  const kept = await workspace.createGroup('Kept');
  await f.combined.layout.setGroupHighlight(group.id, true); await f.combined.layout.setGroupHighlight(kept.id, true);
  await f.combined.layout.setGroupOpacity(group.id, 0.5); await f.combined.layout.setGroupOpacity(kept.id, 0.5);
  await f.combined.layout.setMainGroup(group.id);
  await f.combined.deleteGroup(group.id);
  const layout = workspace.layout.state;
  assert.deepEqual(layout.groupHighlights, { [kept.id]: true }); assert.deepEqual(layout.groupOpacity, { [kept.id]: 0.5 });
  assert.notEqual(f.combined.layout.state.mainGroupId, group.id);
  assert.ok(!Object.values(layout.shortcuts).includes(group.id));
});

test('a shortcut from an older layout bound to the deleted group ends, and a merged one still passes on', async () => {
  const f = await open(); const { workspace } = f.profile('local'); const group = f.groups.local; const kept = await workspace.createGroup('Kept');
  const gone = await workspace.createGroup('Gone');
  await workspace.layout.configure({ shortcuts: { ...workspace.layout.state.shortcuts, 'Ctrl+Alt+1': group.id, 'Ctrl+Alt+2': gone.id } }, workspace.snapshot);
  await workspace.mergeGroup(workspace.previewGroupMerge(gone.id, kept.id));
  await workspace.deleteGroup(group.id);
  const { shortcuts } = workspace.layout.state;
  assert.equal(shortcuts['Ctrl+Alt+1'], undefined); assert.equal(shortcuts['Ctrl+Alt+2'], kept.id);
});

test('a delete takes only what it counted: changes that merely name the group stay', async () => {
  const f = await open(); const { workspace } = f.profile('google:cloud'); const group = f.groups['google:cloud'];
  const other = await workspace.createGroup('Other');
  // Edited here while in this group, then moved on by another device: the note is alive elsewhere and keeps its text.
  const movedOn = await workspace.createCard(content('moved on'), group.id);
  const moved = workspace.blankDraft(group.id, movedOn); moved.content.text = 'unsaved after it moved'; await workspace.saveDraft(moved);
  await receive(workspace, [revisionRecord('card', { ...movedOn, revision: 'moved-to-other', groupId: other.id }, [movedOn.revision])], 'one');
  // Edited here, then trashed by another device: Trash keeps it, and its text.
  const trashed = await workspace.createCard(content('in Trash'), group.id);
  const held = workspace.blankDraft(group.id, trashed); held.content.text = 'unsaved in Trash'; await workspace.saveDraft(held);
  await receive(workspace, [revisionRecord('card', { ...trashed, revision: 'trashed-there', deleted: true }, [trashed.revision])], 'two');
  // The recovery copy of a note deleted forever belongs to Versions.
  await workspace.saveDraft({ id: 'recovery', cardId: 'deleted-forever', groupId: group.id, baseRevision: 'gone', baseContent: content('kept'), content: content('kept'), purged: true });
  assert.deepEqual(counts(workspace.previewGroupDelete(group.id)), { notes: 0, unsaved: 0 });
  await workspace.deleteGroup(group.id);
  assert.deepEqual(activeGroups(workspace.snapshot).map(item => item.id), [other.id], 'none of them keeps the group in sight');
  assert.equal(workspace.cardValue(movedOn.id).deleted, false);
  assert.equal(workspace.unsavedChanges(movedOn.id).content.text, 'unsaved after it moved');
  assert.equal(workspace.unsavedChanges(trashed.id).content.text, 'unsaved in Trash');
  assert.equal(workspace.state.drafts.recovery.content.text, 'kept');
});

test('the question\'s fingerprint changes when a note is swapped or unsaved text changes, even if the counts do not', async () => {
  const f = await open(); const { workspace } = f.profile('local'); const group = f.groups.local;
  const first = await workspace.createCard(content('first'), group.id);
  const asked = workspace.previewGroupDelete(group.id);
  assert.equal(workspace.previewGroupDelete(group.id).fingerprint, asked.fingerprint);
  await workspace.updateCard(first.id, { deleted: true }, first.revision); const second = await workspace.createCard(content('second'), group.id);
  const swapped = workspace.previewGroupDelete(group.id);
  assert.equal(swapped.notes, asked.notes); assert.notEqual(swapped.fingerprint, asked.fingerprint);
  const draft = workspace.blankDraft(group.id, second); draft.content.text = 'one'; await workspace.saveDraft(draft);
  const typed = workspace.previewGroupDelete(group.id);
  await workspace.saveDraft({ ...draft, content: { ...draft.content, text: 'two' } });
  const retyped = workspace.previewGroupDelete(group.id);
  assert.equal(retyped.unsaved, typed.unsaved); assert.notEqual(retyped.fingerprint, typed.fingerprint);
});

test('two first notes at once share one group, in Local notes and in Cloud notes', async () => {
  const f = await open(); const { workspace } = f.profile('local'); await f.combined.deleteGroup(f.groups.local.id);
  const cloud = await device(new DatasetTestProvider());
  for (const target of [workspace, cloud.workspace]) {
    const [one, two] = await Promise.all([target.ensureCaptureGroup(), target.ensureCaptureGroup()]);
    assert.equal(one.id, two.id);
    assert.deepEqual(activeGroups(target.snapshot).map(item => item.id), [one.id]);
  }
});

test('a restore that brings its group back is one step: when it fails, the group stays gone', async () => {
  const f = await open(); const { workspace } = f.profile('local'); const group = f.groups.local;
  const note = await workspace.createCard(content('note'), group.id); await workspace.deleteGroup(group.id);
  await assert.rejects(workspace.restoreCard(note.id, 'an-old-revision', null, { bringGroupBack: true }), { code: 'conflict' });
  assert.deepEqual(activeGroups(workspace.snapshot), []);
  const back = await workspace.restoreCard(note.id, workspace.cardValue(note.id).revision, null, { bringGroupBack: true });
  assert.equal(back.groupId, group.id); assert.deepEqual(activeGroups(workspace.snapshot).map(item => item.id), [group.id]);
  assert.equal(workspace.state.groups.find(item => item.id === group.id).movedAway, undefined);
});

test('adjusting everything ends with the last group', async () => {
  const f = await open();
  for (const id of SECTIONS) await f.combined.createCard(content(id), f.groups[id].id);
  await f.combined.layout.placeNew(f.combined.working, [area]);
  const controller = new InteractionController({ getSnapshot: () => f.combined.working, layout: f.combined.layout, commands: f.combined, saveDraft: async () => {}, releaseDraft: async () => {}, workAreas: () => [area] });
  await controller.activate({ kind: 'all' });
  await f.combined.deleteGroup(f.groups.local.id); await controller.reconcile();
  assert.equal(controller.state.operationScope.kind, 'all', 'another section still has a group to adjust');
  await f.combined.deleteGroup(f.groups['google:cloud'].id); await controller.reconcile();
  assert.equal(controller.state.operationScope.kind, 'none');
});

test('a group with notes in conflict stays until the conflict is settled', async () => {
  const f = await open(); const { workspace } = f.profile('google:cloud'); const group = f.groups['google:cloud'];
  const note = await workspace.createCard(content('original'), group.id);
  await workspace.updateCard(note.id, { content: content('edited here') }, note.revision);
  await receive(workspace, [revisionRecord('card', { ...note, revision: 'edited-there', content: content('edited there') }, [note.revision])], 'one');
  assert.throws(() => workspace.previewGroupDelete(group.id), { code: 'conflict' });
  await assert.rejects(workspace.deleteGroup(group.id), { code: 'conflict' });
  assert.equal(workspace.cardValue(note.id).deleted, false);
  assert.ok(activeGroups(workspace.snapshot).some(item => item.id === group.id));
});

test('a group left behind by a stopped move can be deleted, and the unfinished move ends with it', async () => {
  const f = await open(); const source = f.groups['google:cloud']; const { workspace, storage } = f.profile('google:cloud');
  await f.combined.createCard(content('moved'), source.id); const stays = await f.combined.createCard(content('stays'), source.id);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notesOf(workspace, source.id)[0].id, target);
  await f.combined.deleteGroup(source.id);
  assert.equal(workspace.cardValue(stays.id).deleted, true);
  await f.move.resume();
  assert.deepEqual((await storage.jobs('cross-group', { limit: 10 })).rows, []);
  assert.ok(activeGroups(f.profile('local').workspace.snapshot).some(item => item.id === target), 'the group it moved to stays');
});

test('a section left empty on one device stays empty on the other, whose notes wait in Trash', async () => {
  const provider = new DatasetTestProvider();
  const a = await device(provider); const b = await device(provider);
  const group = await a.workspace.ensureCaptureGroup(); const note = await a.workspace.createCard(content('shared'), group.id);
  await a.sync.sync({ force: true }); await b.sync.sync({ force: true });
  assert.deepEqual(activeGroups(b.workspace.snapshot).map(item => item.id), [group.id]);

  await a.workspace.deleteGroup(group.id); await a.sync.sync({ force: true }); await b.sync.sync({ force: true });
  assert.deepEqual(activeGroups(b.workspace.snapshot), [], 'the other device does not make a new group');
  assert.equal(b.workspace.cardValue(note.id).deleted, true);
  assert.equal(b.workspace.cardValue(note.id).content.text, 'shared');

  // Bringing it back on that device reaches the first one.
  await b.workspace.restoreCard(note.id, b.workspace.cardValue(note.id).revision, null, { bringGroupBack: true });
  await b.sync.sync({ force: true }); await a.sync.sync({ force: true });
  assert.deepEqual(activeGroups(a.workspace.snapshot).map(item => item.id), [group.id]);
  assert.equal(a.workspace.cardValue(note.id).deleted, false);
});

test('a note saved on another device before it heard of the delete keeps the group in sight there and here', async () => {
  const provider = new DatasetTestProvider();
  const a = await device(provider); const b = await device(provider);
  const group = await a.workspace.ensureCaptureGroup(); await a.sync.sync({ force: true }); await b.sync.sync({ force: true });
  const late = await b.workspace.createCard(content('written meanwhile'), group.id);
  await a.workspace.deleteGroup(group.id); await a.sync.sync({ force: true });
  await b.sync.sync({ force: true }); await a.sync.sync({ force: true });
  for (const { workspace } of [a, b]) {
    assert.equal(workspace.cardValue(late.id).deleted, false, 'nothing written elsewhere is lost');
    assert.deepEqual(activeGroups(workspace.snapshot).map(item => item.id), [group.id]);
  }
});
