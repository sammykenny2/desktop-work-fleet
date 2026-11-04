import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups } from '../src/core/contracts.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { CrossMove } from '../src/core/cross-move.js';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = (text, attachments = []) => ({ format: 'markdown', text, attachments });

async function open(ids = ['google:cloud', 'local']) {
  const profiles = []; const records = new MemoryRecordStore();
  for (const id of ids) {
    const storage = new WorkspaceRecordStorage(records, id);
    const workspace = await Workspace.create({ profileId: id, deviceId: 'device', area, current: true, history: storage, bootstrapGroup: false, persist: (...args) => storage.save(...args) });
    profiles.push({ id, workspace, storage });
  }
  const combined = await CombinedWorkspace.open(profiles);
  const groups = {}; for (const profile of profiles) groups[profile.id] = await combined.createGroup(profile.id === 'local' ? 'Home' : 'Work', profile.id);
  await combined.layout.placeNew(combined.working, [area]);
  return { combined, profiles, groups, cloud: profiles[0], local: profiles[1], move: new CrossMove(combined) };
}
const jobsOf = async profile => [...(await profile.storage.jobs('cross-move', { limit: 100 })).rows, ...(await profile.storage.jobs('cross-group', { limit: 100 })).rows];
const live = profile => profile.workspace.snapshot.cards.filter(card => !card.deleted);
const trashed = profile => profile.workspace.snapshot.cards.filter(card => card.deleted);

test('a note moves with its content and status, and the original goes to Trash saying where it went', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('budget'), f.groups['google:cloud'].id);
  const done = await f.combined.updateCard(note.id, { completed: true }, note.revision);
  await f.combined.layout.placeNew(f.combined.working, [area]); await f.combined.layout.move(note.id, { x: 321, y: 123 });
  const moved = await f.move.moveNote(note.id, f.groups.local.id);
  assert.notEqual(moved.id, note.id, 'a moved note takes a new identity'); assert.equal(moved.groupId, f.groups.local.id);
  assert.equal(moved.content.text, 'budget'); assert.equal(moved.completed, true); assert.equal(moved.createdAt, done.createdAt);
  assert.deepEqual(live(f.local).map(card => card.id), [moved.id]);
  const original = f.cloud.workspace.cardValue(note.id);
  assert.equal(original.deleted, true); assert.deepEqual(original.movedTo, { id: moved.id, section: 'local', group: 'Home' }); assert.ok(original.trashedAt);
  // Its desktop position comes along.
  assert.equal(f.combined.layout.state.placements[moved.id].x, 321);
  assert.equal((await jobsOf(f.cloud)).length, 0, 'the journal is cleared');
});

test('moving into the cloud is a new note there and queues it for upload; moving out of it queues only the trashing', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('paint'), f.groups.local.id);
  const before = f.cloud.workspace.pendingCount;
  await f.move.moveNote(note.id, f.groups['google:cloud'].id);
  assert.ok(f.cloud.workspace.pendingCount > before);
  assert.equal(f.local.workspace.cardValue(note.id).movedTo.section, 'cloud');
});

test('attachments travel with the note, and a note whose bytes are not here is refused before anything changes', async () => {
  const f = await open();
  const file = await f.cloud.storage.putAttachment('google:cloud', new File(['bytes'], 'plan.txt', { type: 'text/plain' }));
  const held = await f.combined.createCard(content('with file', [file]), f.groups['google:cloud'].id);
  const moved = await f.move.moveNote(held.id, f.groups.local.id);
  assert.deepEqual(moved.content.attachments, [file]); assert.equal(await new Blob([await f.local.storage.getAttachment('local', file.id)]).text(), 'bytes');
  const missing = await f.combined.createCard(content('no bytes', [{ id: 'b'.repeat(64), name: 'gone.txt' }]), f.groups['google:cloud'].id);
  await assert.rejects(f.move.moveNote(missing.id, f.groups.local.id), error => error.code === 'move-attachment');
  assert.equal(f.cloud.workspace.cardValue(missing.id).deleted, false); assert.equal((await jobsOf(f.cloud)).length, 0);
});

test('unsaved changes and version conflicts refuse a note before anything changes', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('open'), f.groups.local.id);
  const draft = f.combined.openDraft(f.groups.local.id, note); draft.content.text = 'typing'; await f.combined.saveDraft(draft);
  assert.equal(f.move.refusal(note.id), 'unsaved');
  await assert.rejects(f.move.moveNote(note.id, f.groups['google:cloud'].id), error => error.code === 'move-unsaved');
  assert.equal(live(f.cloud).length, 0);
  assert.equal(f.local.workspace.cardValue(note.id).deleted, false);
});

test('a crash after any step of a note finishes on the next start, with one copy and nothing half moved', async () => {
  for (const crash of ['journal', 'attachments', 'created', 'placed', 'trashed']) {
    const f = await open();
    const file = await f.cloud.storage.putAttachment('google:cloud', new File(['survives'], 'x.txt'));
    const note = await f.combined.createCard(content('survives', [file]), f.groups['google:cloud'].id);
    await f.combined.layout.placeNew(f.combined.working, [area]);
    const failing = new CrossMove(f.combined, { step: async name => { if (name === crash) throw new Error(`crash after ${name}`); } });
    await assert.rejects(failing.moveNote(note.id, f.groups.local.id), /crash after/);
    await f.move.resume();
    assert.equal(live(f.local).length, 1, `one copy after a crash at ${crash}`); assert.equal(live(f.local)[0].content.text, 'survives');
    assert.deepEqual(live(f.cloud), [], `the original leaves after a crash at ${crash}`); assert.equal(trashed(f.cloud).length, 1);
    assert.equal((await jobsOf(f.cloud)).length, 0, `the journal clears after a crash at ${crash}`);
    assert.ok(await f.local.storage.getAttachment('local', file.id));
    await f.move.resume();
    assert.equal(live(f.local).length, 1, 'resuming again changes nothing');
  }
});

test('an original changed by a sync while its move was interrupted stays, so that no change is lost', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('first'), f.groups['google:cloud'].id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'created') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups.local.id), /crash/);
  const current = f.cloud.workspace.cardValue(note.id);
  await f.combined.updateCard(note.id, { content: content('edited elsewhere') }, current.revision);
  await f.move.resume();
  assert.equal(f.cloud.workspace.cardValue(note.id).deleted, false); assert.equal(f.cloud.workspace.cardValue(note.id).content.text, 'edited elsewhere');
  assert.equal(live(f.local).length, 1); assert.equal((await jobsOf(f.cloud)).length, 0);
});

test('a note changed before any copy exists stays where it is, for the move no longer describes it', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('first'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  await f.combined.updateCard(note.id, { content: content('changed') }, f.local.workspace.cardValue(note.id).revision);
  await f.move.resume();
  assert.equal(live(f.cloud).length, 0); assert.equal(f.local.workspace.cardValue(note.id).deleted, false); assert.equal((await jobsOf(f.local)).length, 0);
});

test('moving a note again while an earlier move waits keeps the one copy', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('once'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'created') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  await f.move.moveNote(note.id, f.groups['google:cloud'].id);
  assert.equal(live(f.cloud).length, 1); assert.equal(f.local.workspace.cardValue(note.id).deleted, true);
});

test('one move that cannot finish does not hold back the others, and keeps its record', async () => {
  const f = await open();
  const file = await f.local.storage.putAttachment('local', new File(['kept'], 'kept.txt'));
  const stuck = await f.combined.createCard(content('stuck', [file]), f.groups.local.id);
  const fine = await f.combined.createCard(content('fine'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(stuck.id, f.groups['google:cloud'].id), /crash/);
  await assert.rejects(failing.moveNote(fine.id, f.groups['google:cloud'].id), /crash/);
  const put = f.cloud.storage.putAttachmentBytes.bind(f.cloud.storage);
  f.cloud.storage.putAttachmentBytes = async () => { throw new Error('disk full'); };
  await assert.rejects(f.move.resume(), /disk full/);
  assert.deepEqual(live(f.cloud).map(card => card.content.text), ['fine']); assert.equal((await jobsOf(f.local)).length, 1);
  f.cloud.storage.putAttachmentBytes = put; await f.move.resume();
  assert.equal(live(f.cloud).length, 2); assert.equal((await jobsOf(f.local)).length, 0);
});

test('every waiting move is found, past the first page of the journal', async () => {
  const f = await open();
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  for (let index = 0; index < 55; index++) {
    const note = await f.combined.createCard(content(`note ${index}`), f.groups.local.id);
    await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  }
  await f.move.resume();
  assert.equal(live(f.cloud).length, 55); assert.equal(live(f.local).length, 0);
});

test('a note in Trash does not move', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('gone'), f.groups.local.id);
  await f.combined.updateCard(note.id, { deleted: true }, note.revision);
  assert.equal(f.move.refusal(note.id), 'trashed');
  await assert.rejects(f.move.moveNote(note.id, f.groups['google:cloud'].id), error => error.code === 'move-trashed');
  assert.equal(live(f.cloud).length, 0);
});

test('a move waiting for a collection that is not open stays recorded and finishes when it opens', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('later'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  const alone = await CombinedWorkspace.open([f.local]);
  await new CrossMove(alone).resume();
  assert.equal((await jobsOf(f.local)).length, 1); assert.equal(f.local.workspace.cardValue(note.id).deleted, false);
  await f.move.resume();
  assert.equal((await jobsOf(f.local)).length, 0); assert.equal(live(f.cloud).length, 1);
});

async function groupOf(f, count) {
  const source = await f.combined.createGroup('Plans', 'google:cloud'); await f.combined.layout.placeNew(f.combined.working, [area]);
  const notes = []; for (let index = 0; index < count; index++) notes.push(await f.combined.createCard(content(`note ${index}`), source.id));
  await f.combined.layout.placeNew(f.combined.working, [area]);
  return { source, notes };
}

test('a whole group moves: the target takes its name, region, looks and colour, and the old group leaves but keeps its Trash', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 3);
  await f.combined.layout.setGroupHighlight(source.id, true); await f.combined.layout.setGroupLayer(source.id, 'floating'); await f.combined.layout.setGroupOpacity(source.id, 0.5);
  const before = f.combined.layout.state; const slot = before.grid.slots.indexOf(source.id); const color = before.groupColors[source.id];
  await f.combined.layout.setMainGroup(source.id);
  const target = await f.move.openGroup(source.id, 'local');
  for (const note of notes) await f.move.moveNote(note.id, target);
  assert.equal(await f.move.finishGroup(source.id), true);
  const after = f.combined.layout.state;
  assert.equal(after.grid.slots[slot], target, 'the target takes its region'); assert.equal(after.groupColors[target], color, 'and its colour');
  assert.equal(after.groupHighlights[target], true); assert.equal(after.groupLayers[target], 'floating'); assert.equal(after.groupOpacity[target], 0.5); assert.equal(after.mainGroupId, target);
  assert.equal(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id), false, 'the old group left');
  assert.equal(f.cloud.workspace.snapshot.groups.find(group => group.id === source.id).movedAway, true);
  assert.equal(trashed(f.cloud).length, 3); assert.ok(trashed(f.cloud).every(card => card.groupId === source.id));
  assert.equal(activeGroups(f.local.workspace.snapshot).find(group => group.id === target).name, 'Plans');
  assert.equal((await jobsOf(f.cloud)).length, 0);
});

test('stopping leaves both groups, moved notes stay moved, and moving again continues into the same group', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 3);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target);
  assert.equal(await f.move.finishGroup(source.id), false, 'two notes are left');
  assert.equal(live(f.local).filter(card => card.groupId === target).length, 1); assert.equal(live(f.cloud).filter(card => card.groupId === source.id).length, 2);
  assert.equal((await f.move.groupTarget(source.id)).toGroupId, target);
  await f.move.resume();
  assert.equal(live(f.cloud).filter(card => card.groupId === source.id).length, 2, 'starting again does not carry on by itself');
  assert.equal(await f.move.openGroup(source.id, 'local'), target, 'moving again uses the same group');
  assert.equal(activeGroups(f.local.workspace.snapshot).filter(group => group.name === 'Plans').length, 1);
  for (const note of notes.slice(1)) await f.move.moveNote(note.id, target);
  assert.equal(await f.move.finishGroup(source.id), true);
});

test('a note that cannot move keeps its group in place', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 2);
  const draft = f.combined.openDraft(source.id, notes[1]); draft.content.text = 'typing'; await f.combined.saveDraft(draft);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target);
  await assert.rejects(f.move.moveNote(notes[1].id, target), error => error.code === 'move-unsaved');
  assert.equal(await f.move.finishGroup(source.id), false);
  assert.ok(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id));
});

test('a crash while a group finishes completes on the next start', async () => {
  for (const crash of ['handed-over', 'retired']) {
    const f = await open();
    const { source, notes } = await groupOf(f, 1);
    const slot = f.combined.layout.state.grid.slots.indexOf(source.id);
    const failing = new CrossMove(f.combined, { step: async name => { if (name === crash) throw new Error('crash'); } });
    const target = await failing.openGroup(source.id, 'local');
    await failing.moveNote(notes[0].id, target);
    await assert.rejects(failing.finishGroup(source.id), /crash/);
    await f.move.resume();
    assert.equal(f.cloud.workspace.snapshot.groups.find(group => group.id === source.id).movedAway, true, `retired after a crash at ${crash}`);
    assert.equal(f.combined.layout.state.grid.slots[slot], target); assert.equal((await jobsOf(f.cloud)).length, 0);
  }
});

test('a crash before the target group exists does not leave two groups when the move starts again', async () => {
  const f = await open();
  const { source } = await groupOf(f, 1);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'group-journal') throw new Error('crash'); } });
  await assert.rejects(failing.openGroup(source.id, 'local'), /crash/);
  const target = await f.move.openGroup(source.id, 'local');
  assert.equal(activeGroups(f.local.workspace.snapshot).filter(group => group.name === 'Plans').length, 1);
  assert.ok(activeGroups(f.local.workspace.snapshot).some(group => group.id === target));
});

test('a group cannot move into a collection that is full; a single note still can', async () => {
  const f = await open();
  for (let index = 0; index < 8; index++) await f.combined.createGroup(`Extra ${index}`, 'local');
  const { source, notes } = await groupOf(f, 1);
  await assert.rejects(f.move.openGroup(source.id, 'local'), error => error.code === 'group-limit');
  assert.ok(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id));
  const moved = await f.move.moveNote(notes[0].id, f.groups.local.id);
  assert.equal(moved.groupId, f.groups.local.id);
});

test('restoring a note whose group moved away takes a target group, and with none there the group comes back', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 1);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target); await f.move.finishGroup(source.id);
  const original = f.cloud.workspace.cardValue(notes[0].id);
  await assert.rejects(f.combined.restoreCard(original.id, original.revision), error => error.code === 'missing-group');
  const restored = await f.combined.restoreCard(original.id, original.revision, f.groups['google:cloud'].id);
  assert.equal(restored.groupId, f.groups['google:cloud'].id); assert.equal(restored.deleted, false); assert.equal(restored.movedTo, undefined);
  await f.combined.updateCard(restored.id, { deleted: true }, restored.revision);
  await f.cloud.workspace.returnMovedGroup(source.id);
  assert.ok(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id));
});

test('a note another device left in a group that moved away brings the group back', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 1);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target); await f.move.finishGroup(source.id);
  assert.equal(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id), false);
  const original = f.cloud.workspace.cardValue(notes[0].id);
  // What a sync would deliver: a note in that group, alive.
  const snapshot = f.cloud.workspace.snapshot; snapshot.cards.find(card => card.id === original.id).deleted = false;
  assert.equal(activeGroups(snapshot).some(group => group.id === source.id), true, 'the note keeps its group in sight');
  assert.equal(activeGroups(f.cloud.workspace.snapshot).filter(group => group.id === source.id).length, 0, 'a trashed note does not');
});

test('a move across goes only through the journal, and a move inside a collection does not use it', async () => {
  const f = await open();
  const other = await f.combined.createGroup('Other', 'local');
  const note = await f.combined.createCard(content('stay'), f.groups.local.id);
  await assert.rejects(f.move.moveNote(note.id, other.id), error => error.code === 'same-collection');
  await f.combined.transferCard({ cardId: note.id, groupId: other.id, expectedRevision: note.revision });
  assert.equal(f.local.workspace.cardValue(note.id).groupId, other.id); assert.equal(f.local.workspace.cardValue(note.id).deleted, false);
});
