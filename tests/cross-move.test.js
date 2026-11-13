import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups, PinItAnywhereError } from '../src/core/contracts.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { CrossMove } from '../src/core/cross-move.js';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { revisionRecord } from '../src/sources/revisions.js';

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
// What a sync delivers from another device.
const receive = async (workspace, records, cursor) => {
  const session = await workspace.beginSync('other-device'); const expectedCursor = workspace.syncState.cursor;
  await workspace.receiveRevisions(records, { session, expectedCursor, cursor });
  await workspace.endSync(session);
};
const fromOtherDevice = (id, groupId, parents = [], extra = {}) => revisionRecord('card', { id, revision: `${id}-remote`, groupId, content: content('from the other device'), deleted: false, archived: false, completed: false, ...extra }, parents);
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

test('a copy deleted while the note moves leaves the original alive, and the move says so', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('keep me'), f.groups['google:cloud'].id);
  const syncDeletes = new CrossMove(f.combined, { step: async name => {
    if (name !== 'placed') return;
    const copy = live(f.local)[0]; await f.local.workspace.updateCard(copy.id, { deleted: true }, copy.revision);
  } });
  await assert.rejects(syncDeletes.moveNote(note.id, f.groups.local.id), { code: 'move-copy-gone' });
  assert.deepEqual(live(f.cloud).map(card => card.id), [note.id], 'the original stays alive');
  assert.equal(f.cloud.workspace.cardValue(note.id).movedTo, undefined);
  assert.deepEqual(await jobsOf(f.cloud), []);
  // It can simply move again.
  const moved = await f.move.moveNote(note.id, f.groups.local.id);
  assert.deepEqual(live(f.local).map(card => card.id), [moved.id]); assert.deepEqual(live(f.cloud), []);
});

test('a crash just after the copy is deleted also leaves the original alive at the next start', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('keep me'), f.groups['google:cloud'].id);
  const failing = new CrossMove(f.combined, { step: async name => {
    if (name !== 'placed') return;
    const copy = live(f.local)[0]; await f.local.workspace.updateCard(copy.id, { deleted: true }, copy.revision);
    throw new Error('crash');
  } });
  await assert.rejects(failing.moveNote(note.id, f.groups.local.id), /crash/);
  await f.move.resume();
  assert.deepEqual(live(f.cloud).map(card => card.id), [note.id]); assert.deepEqual(await jobsOf(f.cloud), []);
});

test('a sync deleting the copy during the source trash write restores the original and reports refusal', async () => {
  const f = await open(); const note = await f.combined.createCard(content('keep my latest text'), f.groups.local.id);
  const save = f.local.storage.save.bind(f.local.storage); let deleted = false;
  f.local.storage.save = async (state, ...args) => {
    const original = state.cards.find(card => card.id === note.id);
    if (!deleted && original?.deleted && original.movedTo) {
      deleted = true; const copy = f.cloud.workspace.cardValue(original.movedTo.id);
      await receive(f.cloud.workspace, [revisionRecord('card', { ...copy, revision: 'deleted-during-trash', deleted: true,
        trashedAt: new Date().toISOString(), trashEpisode: 'copy-trash' }, [copy.revision])], 'copy-deleted');
    }
    return save(state, ...args);
  };
  await assert.rejects(f.move.moveNote(note.id, f.groups['google:cloud'].id), { code: 'move-copy-gone' });
  assert.deepEqual(live(f.local).map(card => card.id), [note.id]); assert.deepEqual(live(f.cloud), []);
  assert.equal(f.local.workspace.cardValue(note.id).movedTo, undefined);
  assert.deepEqual(await jobsOf(f.local), []);
});

test('a crash after trashing and a failed recovery retain the journal until the original is restored', async () => {
  for (const purged of [false, true]) {
    const f = await open(); const note = await f.combined.createCard(content('recover after restart'), f.groups['google:cloud'].id);
    const crash = new CrossMove(f.combined, { step: async name => { if (name === 'trashed') throw new Error('crash after trash'); } });
    await assert.rejects(crash.moveNote(note.id, f.groups.local.id), /crash after trash/);
    const copy = live(f.local)[0];
    if (purged) await f.local.workspace.applyPermanentDeletion([{ entityId: copy.id, operationId: 'purged-copy' }]);
    else await f.local.workspace.updateCard(copy.id, { deleted: true }, copy.revision);
    const save = f.cloud.storage.save.bind(f.cloud.storage);
    f.cloud.storage.save = async () => { throw new Error('recovery disk full'); };
    await assert.rejects(f.move.resume(), /recovery disk full/);
    assert.equal((await jobsOf(f.cloud)).length, 1, 'the recovery is still durable');
    f.cloud.storage.save = save;
    await f.move.resume();
    assert.deepEqual(live(f.cloud).map(card => card.id), [note.id]); assert.deepEqual(live(f.local), []);
    assert.deepEqual(await jobsOf(f.cloud), []);
    await f.move.resume(); assert.equal(live(f.cloud).length, 1, 'recovery is idempotent');
  }
});

test('a copy deleted while clearing the journal still restores the original', async () => {
  const f = await open(); const note = await f.combined.createCard(content('keep me'), f.groups['google:cloud'].id);
  const clear = f.cloud.storage.deleteJob.bind(f.cloud.storage); let deleted = false;
  f.cloud.storage.deleteJob = async key => {
    await clear(key);
    if (!deleted && key === `cross-move:${note.id}`) {
      deleted = true; const copy = live(f.local)[0];
      await f.local.workspace.updateCard(copy.id, { deleted: true }, copy.revision);
    }
  };
  await assert.rejects(f.move.moveNote(note.id, f.groups.local.id), { code: 'move-copy-gone' });
  assert.deepEqual(live(f.cloud).map(card => card.id), [note.id]); assert.deepEqual(await jobsOf(f.cloud), []);
});

test('a lost acknowledgement of the trash write keeps recovery durable even when memory still shows a live source', async () => {
  const f = await open(); const note = await f.combined.createCard(content('durable original'), f.groups['google:cloud'].id);
  const save = f.cloud.storage.save.bind(f.cloud.storage); let lost = false;
  f.cloud.storage.save = async (state, ...args) => {
    await save(state, ...args);
    if (!lost && state.cards.some(card => card.id === note.id && card.deleted && card.movedTo)) {
      lost = true; const copy = live(f.local)[0];
      await f.local.workspace.applyPermanentDeletion([{ entityId: copy.id, operationId: 'purged-during-lost-ack' }]);
      throw new PinItAnywhereError('native-outcome-unknown', 'The write acknowledgement was lost.');
    }
  };
  await assert.rejects(f.move.moveNote(note.id, f.groups.local.id), { code: 'native-outcome-unknown' });
  assert.equal(f.cloud.workspace.cardValue(note.id).deleted, false, 'memory has not seen the committed trash write');
  assert.equal((await jobsOf(f.cloud)).length, 1);
  f.cloud.storage.save = save;
  const disk = await f.cloud.storage.load(f.cloud.id);
  const reopened = new Workspace(disk, (...args) => f.cloud.storage.save(...args), undefined, undefined, { history: f.cloud.storage });
  assert.equal(reopened.cardValue(note.id).deleted, true, 'the trash write actually committed');
  const combined = await CombinedWorkspace.open([{ ...f.cloud, workspace: reopened }, f.local]);
  await new CrossMove(combined).resume();
  assert.equal(reopened.cardValue(note.id).deleted, false); assert.deepEqual(live(f.local), []);
  assert.deepEqual(await jobsOf(f.cloud), []);
});

test('recovery never reverses a later deliberate choice of the original in Trash', async () => {
  const f = await open(); const note = await f.combined.createCard(content('original'), f.groups['google:cloud'].id);
  const crash = new CrossMove(f.combined, { step: async name => { if (name === 'trashed') throw new Error('crash'); } });
  await assert.rejects(crash.moveNote(note.id, f.groups.local.id), /crash/);
  const original = f.cloud.workspace.cardValue(note.id); const copy = live(f.local)[0];
  await f.cloud.workspace.resolveRevisions({ kind: 'card', entityId: note.id, heads: [original.revision],
    selectedRevision: original.revision, patch: { content: content('deliberately kept in Trash') } });
  await f.local.workspace.updateCard(copy.id, { deleted: true }, copy.revision);
  await f.move.resume();
  assert.equal(f.cloud.workspace.cardValue(note.id).deleted, true);
  assert.equal(f.cloud.workspace.cardValue(note.id).content.text, 'deliberately kept in Trash');
  assert.deepEqual(await jobsOf(f.cloud), []);
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

test('a note from before creation times moves, and takes none with it', async () => {
  const f = await open();
  await receive(f.cloud.workspace, [fromOtherDevice('old-note', f.groups['google:cloud'].id)], 'one');
  assert.equal(f.cloud.workspace.cardValue('old-note').createdAt, undefined);
  const moved = await f.move.moveNote('old-note', f.groups.local.id);
  assert.equal(moved.content.text, 'from the other device'); assert.equal(Object.hasOwn(moved, 'createdAt'), false);
  assert.equal(f.cloud.workspace.cardValue('old-note').deleted, true);
});

test('moving again after a failure past the copy brings the newest text, so Trash never holds the only copy of it', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('first'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'placed') throw new Error('write failed'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /write failed/);
  await f.combined.updateCard(note.id, { content: content('newest') }, f.local.workspace.cardValue(note.id).revision);
  await f.move.moveNote(note.id, f.groups['google:cloud'].id);
  assert.deepEqual(live(f.cloud).map(card => card.content.text).sort(), ['first', 'newest']);
  assert.equal(f.local.workspace.cardValue(note.id).deleted, true);
});

test('a conflict on a note in a moved group can be settled either way on the device that moved it', async () => {
  for (const keep of ['edited', 'trashed']) {
    const f = await open(); const groupId = f.groups['google:cloud'].id; const ws = f.cloud.workspace;
    await f.combined.createGroup('Other', 'google:cloud');
    const note = await f.combined.createCard(content('first'), groupId);
    const target = await f.move.openGroup(groupId, 'local');
    await f.move.moveNote(note.id, target); assert.equal(await f.move.finishGroup(groupId), true);
    await receive(ws, [fromOtherDevice(note.id, groupId, [note.revision], { createdAt: note.createdAt })], 'one');
    const heads = ws.revisionHeads('card', note.id); assert.equal(heads.length, 2);
    const chosen = heads.find(head => head.value.deleted === (keep === 'trashed'));
    await ws.resolveRevisions({ kind: 'card', entityId: note.id, heads: heads.map(head => head.revisionId), selectedRevision: chosen.revisionId });
    const settled = ws.cardValue(note.id); assert.equal(ws.revisionHeads('card', note.id).length, 1);
    assert.equal(settled.deleted, keep === 'trashed');
    assert.equal(activeGroups(ws.snapshot).some(group => group.id === groupId), keep === 'edited', 'a note kept alive brings its group back');
    if (keep === 'edited') { assert.equal(settled.content.text, 'from the other device'); assert.equal(settled.movedTo, undefined); }
  }
});

test('Versions can restore an original whose group moved away', async () => {
  const f = await open(); const groupId = f.groups['google:cloud'].id; const ws = f.cloud.workspace;
  const note = await f.combined.createCard(content('first'), groupId);
  const target = await f.move.openGroup(groupId, 'local');
  await f.move.moveNote(note.id, target); await f.move.finishGroup(groupId);
  const page = await ws.historyPage('card', note.id, {});
  await ws.resolveRevisions({ kind: 'card', entityId: note.id, heads: ws.revisionHeads('card', note.id).map(head => head.revisionId),
    selectedRevision: page.records.find(record => !record.value.deleted).revisionId, fromHistory: true });
  assert.equal(ws.cardValue(note.id).deleted, false); assert.ok(activeGroups(ws.snapshot).some(group => group.id === groupId));
});

test('a stopped move leaves its group alone at the next start, even once something else emptied it', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 2);
  const slot = f.combined.layout.state.grid.slots.indexOf(source.id);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target);
  await f.combined.updateCard(notes[1].id, { deleted: true }, notes[1].revision);
  await f.move.resume();
  assert.ok(activeGroups(f.cloud.workspace.snapshot).some(group => group.id === source.id), 'the user kept this group');
  assert.equal(f.combined.layout.state.grid.slots[slot], source.id, 'and its region');
  assert.equal(await f.move.finishGroup(source.id), true, 'moving it again finishes it');
});

test('a group that came back keeps the record of a move stopped later, so moving it again continues', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 1);
  const first = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, first); await f.move.finishGroup(source.id);
  await receive(f.cloud.workspace, [fromOtherDevice('late-one', source.id), fromOtherDevice('late-two', source.id)], 'one');
  const second = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote('late-one', second); await f.move.resume();
  assert.equal((await f.move.groupTarget(source.id))?.toGroupId, second);
  assert.equal(await f.move.openGroup(source.id, 'local'), second);
});

test('a note still being written when its group moved away keeps the group in sight and can be saved', async () => {
  const f = await open(); const groupId = f.groups['google:cloud'].id; const ws = f.cloud.workspace;
  const draft = ws.blankDraft(groupId); draft.content.text = 'typing'; await ws.saveDraft(draft);
  const group = ws.state.groups.find(item => item.id === groupId);
  await receive(ws, [revisionRecord('group', { ...group, revision: 'moved-elsewhere', movedAway: true }, [group.revision])], 'one');
  assert.ok(f.combined.groups().some(item => item.id === groupId));
  const saved = await ws.commitDraft(draft.id);
  assert.equal(saved.groupId, groupId); assert.equal(saved.deleted, false);
});

test('a note that changes while its attachment loads stays, and the move says it did not happen', async () => {
  const f = await open();
  const file = await f.cloud.storage.putAttachment('google:cloud', new File(['bytes'], 'x.txt'));
  const note = await f.combined.createCard(content('first', [file]), f.groups['google:cloud'].id);
  const read = f.cloud.storage.getAttachment.bind(f.cloud.storage); let changed = false;
  f.cloud.storage.getAttachment = async (...args) => {
    if (!changed) { changed = true; await f.combined.updateCard(note.id, { content: content('changed', [file]) }, note.revision); }
    return read(...args);
  };
  await assert.rejects(f.move.moveNote(note.id, f.groups.local.id), error => error.code === 'move-changed');
  assert.equal(f.cloud.workspace.cardValue(note.id).deleted, false); assert.equal(live(f.local).length, 0); assert.equal((await jobsOf(f.cloud)).length, 0);
});

test('bytes read ahead are used, so a desktop queue does not wait for the network', async () => {
  const f = await open();
  const file = await f.cloud.storage.putAttachment('google:cloud', new File(['bytes'], 'x.txt'));
  const note = await f.combined.createCard(content('first', [file]), f.groups['google:cloud'].id);
  const bytes = await f.move.readAttachments(note.id);
  f.cloud.storage.getAttachment = async () => { throw new Error('this must not read again'); };
  await f.move.moveNote(note.id, f.groups.local.id, bytes);
  assert.ok(await f.local.storage.getAttachment('local', file.id));
});

test('a group moving never grows the grid, and takes its region when it finishes', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 1);
  await f.combined.createGroup('Fourth', 'local'); await f.combined.layout.settle();
  const before = f.combined.layout.desk.state.grid; const slot = before.slots.indexOf(source.id);
  const full = { ...before, slots: before.slots.map((id, index) => id ?? `reserved-${index}`) };
  await f.combined.layout.desk.update(draft => { draft.grid = full; for (const id of full.slots) if (id.startsWith('reserved-')) draft.known[id] = 'google:closed'; });
  const target = await f.move.openGroup(source.id, 'local');
  assert.equal(f.combined.layout.state.grid.slots.includes(target), false, 'the grid is full, so it waits');
  assert.deepEqual(f.combined.layout.takeArrivedOffDesktop(), [], 'and that is no arrival to announce');
  await f.move.moveNote(notes[0].id, target); await f.move.finishGroup(source.id);
  const after = f.combined.layout.desk.state.grid;
  assert.equal(after.rows, before.rows); assert.equal(after.columns, before.columns); assert.equal(after.slots[slot], target);
});

test('a group off the desktop stays off when it moves', async () => {
  const f = await open();
  const { source, notes } = await groupOf(f, 1); const layout = f.combined.layout;
  const grid = layout.state.grid;
  await layout.configure({ grid: { ...grid, slots: grid.slots.map(id => id === source.id ? null : id) } }, f.combined.snapshot); await layout.settle();
  assert.equal(layout.state.hiddenGroups[source.id], true);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target); await f.move.finishGroup(source.id);
  assert.equal(layout.state.hiddenGroups[target], true);
});

test('undo gets past a move inside a section once the note has moved across or gone to Trash', async () => {
  for (const after of ['across', 'trash']) {
    const f = await open();
    const other = await f.combined.createGroup('Other', 'local');
    const note = await f.combined.createCard(content('note'), f.groups.local.id); await f.combined.layout.placeNew(f.combined.working, [area]);
    await f.combined.transferCard({ cardId: note.id, groupId: other.id, expectedRevision: note.revision });
    if (after === 'across') await f.move.moveNote(note.id, f.groups['google:cloud'].id);
    else await f.combined.updateCard(note.id, { deleted: true }, f.local.workspace.cardValue(note.id).revision);
    const entries = f.local.workspace.layout.state.history.length;
    await f.combined.undo([area]);
    assert.equal(f.local.workspace.layout.state.history.length, entries - 1, 'the entry is used up, not stuck on top');
    assert.equal(f.local.workspace.cardValue(note.id).deleted, true);
  }
});

test('a target group in conflict refuses the move before anything changes, and nothing happens later', async () => {
  const f = await open(); const groupId = f.groups['google:cloud'].id; const ws = f.cloud.workspace;
  const group = ws.state.groups.find(item => item.id === groupId);
  await receive(ws, [revisionRecord('group', { ...group, revision: 'other-name', name: 'Other name' }, [])], 'one');
  const note = await f.combined.createCard(content('stays'), f.groups.local.id);
  await assert.rejects(f.move.moveNote(note.id, groupId), error => error.code === 'conflict');
  assert.equal((await jobsOf(f.local)).length, 0);
  const heads = ws.revisionHeads('group', groupId);
  await ws.resolveRevisions({ kind: 'group', entityId: groupId, heads: heads.map(head => head.revisionId), selectedRevision: heads[0].revisionId });
  await f.move.resume();
  assert.equal(f.local.workspace.cardValue(note.id).deleted, false); assert.equal(live(f.cloud).length, 0);
});

test('a moved group on the desktop layer stays there, rather than taking the layer new arrivals get', async () => {
  const f = await open();
  f.local.workspace.setArrivalLayer(() => 'wallpaper');
  const target = await f.move.openGroup(f.groups['google:cloud'].id, 'local');
  assert.equal(f.combined.layout.state.groupLayers[target], 'desktop');
});

test('a crash before the looks came along brings them when the move starts again', async () => {
  const f = await open();
  const { source } = await groupOf(f, 1); await f.combined.layout.setGroupHighlight(source.id, true);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'group-created') throw new Error('crash'); } });
  await assert.rejects(failing.openGroup(source.id, 'local'), /crash/);
  const target = await f.move.openGroup(source.id, 'local');
  assert.equal(f.combined.layout.state.groupHighlights[target], true);
});

test('a group that came back counts toward nine, so ten raise the overflow every other way of reaching ten does', async () => {
  const f = await open(); const ws = f.cloud.workspace;
  const { source, notes } = await groupOf(f, 1);
  const target = await f.move.openGroup(source.id, 'local');
  await f.move.moveNote(notes[0].id, target); await f.move.finishGroup(source.id);
  for (let index = activeGroups(ws.state).length; index < 9; index++) await f.combined.createGroup(`More ${index}`, 'google:cloud');
  await receive(ws, [fromOtherDevice('late', source.id)], 'one');
  assert.equal(activeGroups(ws.state).length, 10); assert.ok(ws.state.conflicts.some(item => item.kind === 'group-overflow'));
});

test('a target group merged since the move began receives it through the merge', async () => {
  const f = await open();
  const into = await f.combined.createGroup('Into', 'google:cloud');
  const note = await f.combined.createCard(content('note'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  const plan = f.combined.previewGroupMerge(f.groups['google:cloud'].id, into.id);
  await f.combined.mergeGroup(plan, [area]);
  await f.move.resume();
  assert.deepEqual(live(f.cloud).map(card => card.groupId), [into.id]);
});

test('a copy the user trashed meanwhile leaves the original alive, whether moving again or starting again', async () => {
  for (const next of ['start', 'move']) {
    const f = await open();
    const note = await f.combined.createCard(content('note'), f.groups.local.id);
    const failing = new CrossMove(f.combined, { step: async name => { if (name === 'placed') throw new Error('write failed'); } });
    await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /write failed/);
    const [copy] = live(f.cloud);
    await f.combined.updateCard(copy.id, { deleted: true }, copy.revision);
    if (next === 'start') {
      await f.move.resume();
      assert.equal(f.local.workspace.cardValue(note.id).deleted, false, 'neither may end in Trash unasked');
    } else {
      const moved = await f.move.moveNote(note.id, f.groups['google:cloud'].id);
      assert.notEqual(moved.id, copy.id); assert.equal(moved.deleted, false);
      assert.equal(f.local.workspace.cardValue(note.id).deleted, true);
    }
    assert.equal((await jobsOf(f.local)).length, 0);
  }
});

test('a copy purged meanwhile leaves the original alive and its id is never used again', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('note'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  const [{ value: job }] = (await f.local.storage.jobs('cross-move', { limit: 1 })).rows;
  const moved = await f.move.moveNote(note.id, f.groups['google:cloud'].id);
  assert.notEqual(moved.id, job.newCardId, 'with no live copy of this version, there is nothing to resume');
  const second = await f.combined.createCard(content('second'), f.groups.local.id);
  await f.local.storage.putJob(`cross-move:${second.id}`, { kind: 'cross-move', cardId: second.id, revision: second.revision, toProfile: 'google:cloud', toGroupId: f.groups['google:cloud'].id, toGroupName: 'Work', newCardId: 'purged-copy', copied: true });
  await f.move.resume();
  assert.equal(f.cloud.workspace.cardValue('purged-copy'), null); assert.equal(f.local.workspace.cardValue(second.id).deleted, false);
  assert.equal((await jobsOf(f.local)).length, 0);
});

test('unsaved changes keep the original at the next start, so the newest words never sit on a note in Trash', async () => {
  for (const crash of ['journal', 'created']) {
    const f = await open();
    const note = await f.combined.createCard(content('saved'), f.groups.local.id);
    const failing = new CrossMove(f.combined, { step: async name => { if (name === crash) throw new Error('crash'); } });
    await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
    const draft = f.combined.openDraft(f.groups.local.id, f.local.workspace.cardValue(note.id)); draft.content.text = 'still typing'; await f.combined.saveDraft(draft);
    await f.move.resume();
    assert.equal(f.local.workspace.cardValue(note.id).deleted, false, `kept after a crash at ${crash}`);
    assert.equal(live(f.cloud).length, crash === 'journal' ? 0 : 1); assert.equal((await jobsOf(f.local)).length, 0);
  }
});

test('a change landing after the copy keeps both and says so, rather than reporting a move', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('first'), f.groups.local.id);
  const changing = new CrossMove(f.combined, { step: async name => {
    if (name === 'placed') await f.combined.updateCard(note.id, { content: content('changed') }, f.local.workspace.cardValue(note.id).revision);
  } });
  await assert.rejects(changing.moveNote(note.id, f.groups['google:cloud'].id), error => error.code === 'move-both' && error.message.includes('Work'));
  assert.equal(f.local.workspace.cardValue(note.id).content.text, 'changed'); assert.equal(f.local.workspace.cardValue(note.id).deleted, false);
  assert.deepEqual(live(f.cloud).map(card => card.content.text), ['first']); assert.equal((await jobsOf(f.local)).length, 0);
});

test('Versions cannot bring a moved group back as a tenth; the note can still stay in Trash', async () => {
  const f = await open(); const groupId = f.groups['google:cloud'].id; const ws = f.cloud.workspace;
  const note = await f.combined.createCard(content('first'), groupId);
  const target = await f.move.openGroup(groupId, 'local');
  await f.move.moveNote(note.id, target); await f.move.finishGroup(groupId);
  for (let index = activeGroups(ws.state).length; index < 9; index++) await f.combined.createGroup(`More ${index}`, 'google:cloud');
  const page = await ws.historyPage('card', note.id, {}); const heads = ws.revisionHeads('card', note.id).map(head => head.revisionId);
  await assert.rejects(ws.resolveRevisions({ kind: 'card', entityId: note.id, heads, selectedRevision: page.records.find(record => !record.value.deleted).revisionId, fromHistory: true }), error => error.code === 'group-limit');
  assert.equal(activeGroups(ws.state).length, 9);
});

test('a group kept by a note being written can still change its looks, and a blank draft keeps nothing', async () => {
  for (const text of ['', 'typing']) {
    const f = await open(); const ws = f.cloud.workspace; const groupId = f.groups['google:cloud'].id;
    const draft = ws.blankDraft(groupId); draft.content.text = text; await ws.saveDraft(draft);
    const group = ws.state.groups.find(item => item.id === groupId);
    await receive(ws, [revisionRecord('group', { ...group, revision: 'moved-elsewhere', movedAway: true }, [group.revision])], 'one');
    assert.equal(f.combined.groups().some(item => item.id === groupId), Boolean(text), 'only written words hold it');
    assert.equal(activeGroups(f.combined.snapshot).some(item => item.id === groupId), Boolean(text), 'the merged snapshot agrees');
    if (text) {
      await f.combined.layout.setGroupHighlight(groupId, true); await f.combined.layout.setGroupOpacity(groupId, 0.5);
      assert.equal(f.combined.layout.state.groupOpacity[groupId], 0.5);
    }
  }
});

test('undo gets past a move inside a section whose old group has since moved away', async () => {
  const f = await open();
  const other = await f.combined.createGroup('Other', 'local'); const old = await f.combined.createGroup('Old', 'local');
  const note = await f.combined.createCard(content('note'), old.id); await f.combined.layout.placeNew(f.combined.working, [area]);
  await f.combined.transferCard({ cardId: note.id, groupId: other.id, expectedRevision: note.revision });
  const target = await f.move.openGroup(old.id, 'google:cloud'); assert.equal(await f.move.finishGroup(old.id), true); assert.ok(target);
  const entries = f.local.workspace.layout.state.history.length;
  await f.combined.undo([area]);
  assert.equal(f.local.workspace.layout.state.history.length, entries - 1);
  assert.equal(f.local.workspace.cardValue(note.id).groupId, other.id);
});

test('a conflict arriving while a move waits leaves the note to be settled, and nothing fails at every start', async () => {
  for (const crash of ['journal', 'created']) {
    const f = await open();
    const note = await f.combined.createCard(content('first'), f.groups.local.id);
    await f.combined.updateCard(note.id, { content: content('second') }, note.revision);
    const failing = new CrossMove(f.combined, { step: async name => { if (name === crash) throw new Error('crash'); } });
    await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
    await receive(f.local.workspace, [fromOtherDevice(note.id, f.groups.local.id, [note.revision], { createdAt: note.createdAt })], 'one');
    assert.equal(f.local.workspace.revisionHeads('card', note.id).length, 2);
    await f.move.resume();
    assert.equal(f.local.workspace.cardValue(note.id).deleted, false);
    assert.equal(live(f.cloud).length, crash === 'journal' ? 0 : 1); assert.equal((await jobsOf(f.local)).length, 0);
    await f.move.resume();
  }
});

test('moving again past a copy still marks it, so a later purge of it can never bring its id back', async () => {
  const f = await open();
  const note = await f.combined.createCard(content('note'), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'placed') throw new Error('write failed'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /write failed/);
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /write failed/);
  assert.equal(live(f.cloud).length, 1, 'still the one copy');
  const [{ value: job }] = (await f.local.storage.jobs('cross-move', { limit: 1 })).rows;
  assert.equal(job.copied, true);
});

test('a move whose attachment can no longer be read says so once at the next start, and then leaves the note in peace', async () => {
  const f = await open();
  const file = await f.local.storage.putAttachment('local', new File(['bytes'], 'x.txt'));
  const note = await f.combined.createCard(content('note', [file]), f.groups.local.id);
  const failing = new CrossMove(f.combined, { step: async name => { if (name === 'journal') throw new Error('crash'); } });
  await assert.rejects(failing.moveNote(note.id, f.groups['google:cloud'].id), /crash/);
  f.local.storage.getAttachment = async () => null;
  await assert.rejects(f.move.resume(), error => error.code === 'move-attachment');
  assert.equal((await jobsOf(f.local)).length, 0);
  await f.move.resume();
  assert.equal(f.local.workspace.cardValue(note.id).deleted, false); assert.equal(live(f.cloud).length, 0);
});
