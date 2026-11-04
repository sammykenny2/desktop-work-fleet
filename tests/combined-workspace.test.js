import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups, copy, eligible, gridRegions } from '../src/core/contracts.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { Workspace } from '../src/core/workspace.js';
import { groupHighlighted } from '../src/layout/store.js';
import { settleDesk } from '../src/layout/desk.js';
import { projectDesktop } from '../src/desktop/projection.js';
import { idleInteraction, InteractionController } from '../src/interaction/controller.js';
import { planFormation } from '../src/layout/formation.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });
const controls = () => {
  const values = new Map();
  return { getControl: async key => copy(values.get(key) ?? null), putControl: async (key, value) => { values.set(key, copy(value)); }, values };
};

// Three profiles, so that nothing can assume exactly two.
async function open(ids = ['google:primary', 'local', 'local:second'], { storage = controls() } = {}) {
  const profiles = [];
  for (const id of ids) {
    let disk;
    const workspace = await Workspace.create({ profileId: id, deviceId: 'device', area, persist: async state => { disk = copy(state); }, bootstrapGroup: false });
    profiles.push({ id, workspace, storage, disk: () => disk });
  }
  const group = {};
  for (const [index, profile] of profiles.entries()) group[index] = await profile.workspace.createGroup(`Group ${index}`);
  const combined = await CombinedWorkspace.open(profiles, storage);
  await combined.layout.placeNew(combined.working, [area]);
  return { combined, profiles, group, storage };
}

test('ids two collections hold are found, whenever they arrive', async () => {
  const { combined, profiles, group } = await open();
  const note = await combined.createCard(content('one'), group[1].id);
  assert.deepEqual(combined.sharedIds(), []);
  await profiles[0].workspace.adoptCard({ id: note.id, groupId: group[0].id, content: content('the same id, from a sync'), archived: false, completed: false });
  assert.deepEqual(combined.sharedIds(), [note.id]);
  await profiles[2].workspace.adoptGroup({ id: group[0].id, name: 'The same group id' });
  assert.deepEqual(combined.sharedIds().sort(), [note.id, group[0].id].sort());
});

test('text being written stays with its collection when another comes to share its ids', async () => {
  const { combined, profiles, group } = await open();
  const note = await combined.createCard(content('local'), group[1].id);
  const open_ = combined.openDraft(group[1].id, note);
  await profiles[0].workspace.adoptCard({ id: note.id, groupId: group[0].id, content: content('the same id, from a sync'), archived: false, completed: false });
  open_.content.text = 'typed before its first save'; await combined.saveDraft(open_);
  assert.equal(profiles[1].workspace.unsavedChanges(note.id).content.text, 'typed before its first save');
  assert.equal(profiles[0].workspace.unsavedChanges(note.id), null);
  open_.content.text = 'typed after it'; await combined.saveDraft(open_);
  assert.equal(profiles[1].workspace.unsavedChanges(note.id).content.text, 'typed after it');
  assert.equal(profiles[0].workspace.unsavedChanges(note.id), null);
  const fresh = combined.openDraft(group[1].id);
  await profiles[0].workspace.adoptGroup({ id: group[1].id, name: 'The same group id' });
  fresh.content.text = 'a new note'; await combined.saveDraft(fresh);
  assert.ok(profiles[1].workspace.holdsDraft(fresh.id)); assert.ok(!profiles[0].workspace.holdsDraft(fresh.id));
});

test('reads merge every profile, and a write reaches only the profile that holds it', async () => {
  const { combined, profiles, group } = await open();
  assert.deepEqual(activeGroups(combined.snapshot).map(item => item.name), ['Group 0', 'Group 1', 'Group 2']);
  const note = await combined.createCard(content('one'), group[1].id);
  assert.equal(profiles[1].workspace.snapshot.cards.length, 1);
  assert.equal(profiles[0].workspace.snapshot.cards.length + profiles[2].workspace.snapshot.cards.length, 0);
  assert.deepEqual(combined.working.cards.map(card => card.id), [note.id]);
  const updated = await combined.updateCard(note.id, { completed: true }, note.revision);
  assert.equal(profiles[1].workspace.snapshot.cards[0].revision, updated.revision);
  const draft = combined.openDraft(group[2].id); draft.content.text = 'unsaved'; await combined.saveDraft(draft);
  assert.ok(profiles[2].workspace.holdsDraft(draft.id)); assert.equal(combined.draft(draft.id).content.text, 'unsaved');
  assert.equal(combined.unsavedChanges(draft.cardId).content.text, 'unsaved');
  await combined.commitDraft(draft.id);
  assert.equal(profiles[2].workspace.snapshot.cards.length, 1);
});

test('a request for something no open profile holds is refused, and no move crosses a profile by accident', async () => {
  const { combined, group } = await open();
  assert.throws(() => combined.updateCard('missing', {}, 'x'), error => error.code === 'missing-card');
  assert.throws(() => combined.createCard(content('x'), 'missing'), error => error.code === 'missing-group');
  const note = await combined.createCard(content('one'), group[0].id);
  await assert.rejects(combined.transferCard({ cardId: note.id, groupId: group[1].id, expectedRevision: note.revision }), error => error.code === 'other-collection');
  assert.equal(combined.working.cards[0].groupId, group[0].id);
  assert.throws(() => combined.previewGroupMerge(group[0].id, group[1].id), error => error.code === 'other-collection');
});

test('the desk holds what a computer has one of, and each profile keeps its own placements and looks', async () => {
  const { combined, profiles, group, storage } = await open();
  await combined.layout.configure({ desktopVisible: false, quickMove: true, mainView: 'list' }, combined.snapshot);
  await combined.layout.setMainGroup(group[2].id);
  await combined.layout.setGroupHighlight(group[1].id, true); await combined.layout.setGroupOpacity(group[2].id, 0.5); await combined.layout.setGroupLayer(group[0].id, 'floating');
  const state = combined.layout.state;
  assert.equal(state.desktopVisible, false); assert.equal(state.quickMove, true); assert.equal(state.mainView, 'list'); assert.equal(state.mainGroupId, group[2].id);
  assert.equal(groupHighlighted(state, group[1].id), true); assert.equal(state.groupOpacity[group[2].id], 0.5); assert.equal(state.groupLayers[group[0].id], 'floating');
  // A profile's own layout holds its looks, so its backups keep them; the device's settings stay out of them.
  assert.equal(groupHighlighted(profiles[1].workspace.layout.state, group[1].id), true);
  assert.equal(profiles[0].workspace.layout.state.desktopVisible, true);
  assert.equal(storage.values.get('desk').desktopVisible, false);
  await assert.rejects(combined.layout.configure({ nothing: true }, combined.snapshot), error => error.code === 'invalid-setting');
  const old = combined.snapshot; await combined.createGroup('Late');
  await assert.rejects(combined.layout.configure({ desktopVisible: true }, old), error => error.code === 'stale-groups');
});

test('the desk survives reopening, and the first start takes its settings from the primary', async () => {
  const storage = controls(); let disk;
  const workspace = await Workspace.create({ profileId: 'google:primary', deviceId: 'device', area, persist: async state => { disk = copy(state); } });
  await workspace.layout.configure({ quickMove: true, shortcuts: { ...workspace.layout.state.shortcuts, 'Alt+F2': '@capture' } }, workspace.snapshot);
  const first = await CombinedWorkspace.open([{ id: 'google:primary', workspace, storage }], storage);
  assert.equal(first.layout.state.quickMove, true); assert.equal(first.layout.state.shortcuts['Alt+F2'], '@capture');
  await first.layout.configure({ quickMove: false }, first.snapshot);
  const reopened = await CombinedWorkspace.open([{ id: 'google:primary', workspace: new Workspace(disk, async state => { disk = copy(state); }), storage }], storage);
  assert.equal(reopened.layout.state.quickMove, false, 'a saved desk is not seeded again');
});

test('a group in no region is off the desktop: not eligible, not placed, not in a formation', async () => {
  const { combined, group } = await open();
  const shown = await combined.createCard(content('shown'), group[0].id); const off = await combined.createCard(content('off'), group[1].id);
  const grid = combined.layout.state.grid;
  await combined.layout.configure({ grid: { ...grid, slots: grid.slots.map(id => id === group[1].id ? null : id) } }, combined.snapshot);
  await combined.layout.placeNew(combined.working, [area]);
  const state = combined.layout.state;
  assert.equal(state.hiddenGroups[group[1].id], true);
  assert.equal(eligible(combined.working.cards.find(card => card.id === off.id), state), false);
  assert.ok(state.placements[shown.id]); assert.equal(state.placements[off.id], undefined, 'a paper off the desktop takes no place');
  // It stays out of a scene, and comes back placed in its region.
  const frame = () => projectDesktop({ snapshot: combined.working, layout: combined.layout.state, interaction: idleInteraction(), sessionId: 'session', sequence: 1, workspaceRevision: combined.revision, layers: ['desktop', 'floating', 'wallpaper'] });
  assert.deepEqual(frame().cards.map(card => card.id), [shown.id]);
  await combined.layout.configure({ grid }, combined.snapshot); await combined.layout.placeNew(combined.working, [area]);
  const region = gridRegions(combined.layout.state.grid).find(item => item.groupId === group[1].id);
  const placed = combined.layout.state.placements[off.id];
  assert.ok(placed.x >= region.x && placed.x < region.x + region.width);
  assert.deepEqual(frame().cards.map(card => card.id).sort(), [shown.id, off.id].sort());
});

test('a group taken off the desktop stays off, and a paper there keeps its place for when it returns', async () => {
  const { combined, group } = await open();
  const note = await combined.createCard(content('kept'), group[1].id); await combined.layout.placeNew(combined.working, [area]);
  await combined.layout.move(note.id, { x: 700, y: 500 });
  const grid = combined.layout.state.grid;
  await combined.layout.configure({ grid: { ...grid, slots: grid.slots.map(id => id === group[1].id ? null : id) } }, combined.snapshot);
  await combined.layout.placeNew(combined.working, [area]);
  assert.equal(combined.layout.state.grid.slots.includes(group[1].id), false, 'settling does not put it back');
  await combined.layout.configure({ grid }, combined.snapshot);
  assert.equal(combined.layout.state.placements[note.id].x, 700);
});

test('a new group takes a free region, the grid grows until nine, and past that it stays off with no place taken', async () => {
  const { combined, profiles } = await open(['google:primary', 'local']);
  const made = [];
  for (let index = 0; index < 7; index++) { made.push(await combined.createGroup(`Extra ${index}`, profiles[index % 2].id)); await combined.layout.placeNew(combined.working, [area]); }
  const state = combined.layout.state;
  assert.equal(state.grid.slots.filter(Boolean).length, 9); assert.ok(state.grid.rows * state.grid.columns <= 9);
  for (const id of state.grid.slots) assert.ok(id);
  const late = await combined.createGroup('Past nine', profiles[1].id); await combined.layout.placeNew(combined.working, [area]);
  assert.equal(combined.layout.state.grid.slots.includes(late.id), false); assert.equal(combined.layout.state.hiddenGroups[late.id], true);
  // Giving it a region takes it from nobody else silently: the user replaces one in Settings.
  assert.equal(combined.layout.state.grid.slots.length, 9);
});

test('regions of a profile that is not open stay reserved, and return when it does', () => {
  const desk = { revision: 0, grid: { rows: 1, columns: 3, area, slots: ['cloud', 'local', null] }, groupColors: { cloud: 4, local: 1 }, known: { cloud: 'google:a', local: 'local' } };
  const resolve = () => null;
  const signedOut = settleDesk(desk, [{ id: 'local', profileId: 'local' }], ['local'], resolve);
  assert.deepEqual(signedOut.grid.slots, ['cloud', 'local', null]); assert.equal(signedOut.groupColors.cloud, 4, 'its colour is kept for its return');
  assert.deepEqual(gridRegions(signedOut.grid).map(region => region.groupId), ['cloud', 'local', null]);
  const back = settleDesk(signedOut, [{ id: 'cloud', profileId: 'google:a' }, { id: 'local', profileId: 'local' }], ['google:a', 'local'], resolve);
  assert.deepEqual(back.grid.slots, ['cloud', 'local', null]); assert.equal(back.groupColors.cloud, 4);
});

test('a retired group gives its region to the group it merged into, or frees it', () => {
  const desk = { revision: 0, mainGroupId: 'old', grid: { rows: 1, columns: 3, area, slots: ['old', 'gone', 'kept'] }, groupColors: {}, known: { old: 'local', gone: 'local', kept: 'local', target: 'local' } };
  const settled = settleDesk(desk, [{ id: 'target', profileId: 'local' }, { id: 'kept', profileId: 'local' }], ['local'], id => id === 'old' ? 'target' : null);
  assert.deepEqual(settled.grid.slots, ['target', null, 'kept']); assert.equal(settled.mainGroupId, 'target');
  assert.equal(settled.known.gone, undefined);
});

test('one colour table covers every profile: colours differ until there are more than nine groups, and a swap crosses profiles', async () => {
  const { combined, group } = await open();
  const colors = () => combined.layout.state.groupColors;
  const worn = Object.values(colors()); assert.equal(new Set(worn).size, worn.length);
  const before = colors(); await combined.layout.setGroupColor(group[0].id, before[group[2].id]);
  assert.equal(colors()[group[0].id], before[group[2].id]); assert.equal(colors()[group[2].id], before[group[0].id]);
});

test('a formation across profiles applies to each and undoes as one action; a move undoes on its own', async () => {
  const { combined, group, profiles } = await open();
  const a = await combined.createCard(content('a'), group[0].id); const b = await combined.createCard(content('b'), group[1].id);
  await combined.layout.placeNew(combined.working, [area]);
  await combined.layout.move(a.id, { x: 40, y: 40 }); await combined.layout.move(b.id, { x: 500, y: 300 });
  const controller = new InteractionController({ getSnapshot: () => combined.working, layout: combined.layout, commands: combined, saveDraft: async () => {}, releaseDraft: async () => {}, workAreas: () => [area] });
  const before = combined.layout.state.placements;
  const plan = planFormation({ snapshot: combined.working, layout: combined.layout.state, scope: { kind: 'all' }, mode: 'stack', workAreas: [area], summaryBands: { [a.id]: 36, [b.id]: 36 } });
  await controller.applyFormation(plan);
  const after = combined.layout.state.placements;
  assert.notDeepEqual([after[a.id].x, after[b.id].x], [before[a.id].x, before[b.id].x]);
  assert.equal(profiles[0].workspace.layout.state.history.at(-1).kind, 'formation'); assert.equal(profiles[1].workspace.layout.state.history.at(-1).kind, 'formation');
  await combined.undo([area]);
  assert.equal(combined.layout.state.placements[a.id].x, before[a.id].x); assert.equal(combined.layout.state.placements[b.id].x, before[b.id].x);
  await combined.undo([area]);
  assert.notEqual(combined.layout.state.placements[b.id].y, 300, 'the last move undoes first');
  assert.equal(combined.layout.state.placements[a.id].y, 40, 'the earlier move stays');
});

test('undo finds the newest action after a restart, and a formation across profiles still undoes as one', async () => {
  const { combined, group, profiles, storage } = await open();
  const a = await combined.createCard(content('a'), group[0].id); const b = await combined.createCard(content('b'), group[1].id);
  await combined.layout.placeNew(combined.working, [area]);
  await combined.layout.move(a.id, { x: 40, y: 40 }); await combined.layout.move(b.id, { x: 500, y: 300 });
  const before = combined.layout.state.placements;
  await combined.layout.applyFormation(planFormation({ snapshot: combined.working, layout: combined.layout.state, scope: { kind: 'all' }, mode: 'stack', workAreas: [area], summaryBands: { [a.id]: 36, [b.id]: 36 } }), () => combined.working);
  const again = await CombinedWorkspace.open(profiles, storage);
  await again.undo([area]);
  assert.equal(again.layout.state.placements[a.id].x, before[a.id].x); assert.equal(again.layout.state.placements[b.id].x, before[b.id].x);
  await again.undo([area]);
  assert.notEqual(again.layout.state.placements[b.id].y, 300, 'the later move undoes first'); assert.equal(again.layout.state.placements[a.id].y, 40);
});

test('a merge passes its region and the main group on as soon as it lands', async () => {
  const { combined, group, profiles } = await open();
  const second = await combined.createGroup('Second', profiles[0].id); await combined.layout.placeNew(combined.working, [area]);
  const grid = combined.layout.state.grid;
  await combined.layout.configure({ grid: { ...grid, slots: grid.slots.map(id => id === second.id ? null : id) } }, combined.snapshot);
  await combined.layout.setMainGroup(group[0].id);
  const held = combined.layout.state.grid.slots.indexOf(group[0].id);
  await combined.mergeGroup(combined.previewGroupMerge(group[0].id, second.id));
  assert.equal(combined.layout.state.grid.slots[held], second.id); assert.equal(combined.layout.state.mainGroupId, second.id);
});

test('choosing a colour keeps the colours of a collection that is not open', async () => {
  const storage = controls(); let disk;
  const local = await Workspace.create({ profileId: 'local', deviceId: 'device', area, persist: async state => { disk = copy(state); } });
  await storage.putControl('desk', { revision: 1, grid: { rows: 1, columns: 2, area, slots: ['cloud-group', null] }, groupColors: { 'cloud-group': 5 }, known: { 'cloud-group': 'google:a' } });
  const combined = await CombinedWorkspace.open([{ id: 'local', workspace: local, storage }]);
  const own = activeGroups(local.snapshot)[0];
  await combined.layout.setGroupColor(own.id, 2);
  assert.equal(combined.layout.groupColors['cloud-group'], 5); assert.equal(combined.layout.groupColors[own.id], 2);
  assert.deepEqual(combined.layout.state.grid.slots.includes('cloud-group'), true, 'its region stays reserved');
  assert.equal(combined.layout.state.liveSlots.includes('cloud-group'), false, 'a key for that region acts on nothing');
  assert.ok(disk);
});

test('another account being open frees the regions of the account before it', () => {
  const desk = { revision: 0, grid: { rows: 1, columns: 2, area, slots: ['old', 'local'] }, groupColors: {}, known: { old: 'google:a', local: 'local' } };
  const settled = settleDesk(desk, [{ id: 'new', profileId: 'google:b' }, { id: 'local', profileId: 'local' }], ['google:b', 'local'], () => null);
  assert.deepEqual(settled.grid.slots, ['new', 'local']); assert.equal(settled.known.old, undefined);
});

test('after a reset a group of a collection not open takes a free region when it returns', () => {
  const desk = { revision: 0, grid: { rows: 1, columns: 2, area, slots: ['local', null] }, groupColors: {}, known: {} };
  const settled = settleDesk(desk, [{ id: 'cloud', profileId: 'google:a' }, { id: 'local', profileId: 'local' }], ['google:a', 'local'], () => null);
  assert.deepEqual(settled.grid.slots, ['local', 'cloud']);
});

test('a plan made before any profile changed is refused, as a plan for one profile is', async () => {
  const { combined, group } = await open();
  const a = await combined.createCard(content('a'), group[0].id); const b = await combined.createCard(content('b'), group[1].id);
  await combined.layout.placeNew(combined.working, [area]);
  const plan = planFormation({ snapshot: combined.working, layout: combined.layout.state, scope: { kind: 'all' }, mode: 'stack', workAreas: [area], summaryBands: { [a.id]: 36, [b.id]: 36 } });
  await combined.layout.move(b.id, { x: 500, y: 300 });
  await assert.rejects(combined.layout.applyFormation(plan, () => combined.working), error => error.code === 'stale-plan');
});

test('a reset clears each profile and lays regions out from the list, as far as nine reach', async () => {
  const { combined, profiles, group } = await open();
  const note = await combined.createCard(content('a'), group[1].id); await combined.layout.placeNew(combined.working, [area]);
  await combined.layout.configure({ desktopVisible: false, quickMove: true, grid: { ...combined.layout.state.grid, slots: combined.layout.state.grid.slots.map(() => null) } }, combined.snapshot);
  await combined.layout.reset(combined.snapshot, area, 'wallpaper');
  const state = combined.layout.state;
  assert.equal(state.desktopVisible, true); assert.equal(state.quickMove, undefined);
  assert.deepEqual(state.grid.slots.filter(Boolean), [group[0].id, group[1].id, group[2].id]);
  assert.deepEqual(state.placements, {}); assert.equal(state.groupLayers[group[1].id], 'wallpaper');
  assert.deepEqual(profiles[1].workspace.layout.state.placements, {});
  await combined.layout.placeNew(combined.working, [area]); assert.ok(combined.layout.state.placements[note.id]);
});

test('a layout revision grows with any profile or the desk, so a stale drag is refused', async () => {
  const { combined, group } = await open();
  const note = await combined.createCard(content('a'), group[0].id); await combined.layout.placeNew(combined.working, [area]);
  const revision = combined.layout.state.revision;
  await combined.layout.setGroupHighlight(group[2].id, true);
  assert.ok(combined.layout.state.revision > revision);
  await assert.rejects(combined.layout.move(note.id, { x: 10, y: 10 }, revision), error => error.code === 'stale-layout');
  await combined.layout.move(note.id, { x: 10, y: 10 }, combined.layout.state.revision);
});

test('a group moved away stays out of every active list but keeps its trashed notes a home', async () => {
  const snapshot = { groups: [{ id: 'g', deleted: false, movedAway: true }, { id: 'h', deleted: false }] };
  assert.deepEqual(activeGroups(snapshot).map(group => group.id), ['h']);
});

test('one profile behaves as it did before there were several', async () => {
  const { combined, profiles, group } = await open(['local']);
  assert.deepEqual(combined.snapshot, profiles[0].workspace.snapshot);
  assert.deepEqual(combined.working, profiles[0].workspace.working);
  const note = await combined.createCard(content('a'), group[0].id); await combined.layout.placeNew(combined.working, [area]);
  assert.ok(combined.layout.state.placements[note.id]);
  assert.equal(combined.layout.state.hiddenGroups[group[0].id], undefined);
});

test('the desk copy that changed last leads, and every copy catches up', async () => {
  const one = controls(); const two = controls(); const local = await Workspace.create({ profileId: 'local', deviceId: 'device', area, persist: async () => {} });
  const cloud = await Workspace.create({ profileId: 'google:a', deviceId: 'device', area, persist: async () => {}, bootstrapGroup: false });
  const desk = revision => ({ revision, grid: { rows: 1, columns: 3, area, slots: [null, null, null] }, groupColors: {}, known: {}, mainView: revision === 7 ? 'list' : 'board' });
  // Local notes could not open for a while, so only the account's copy moved on.
  await one.putControl('desk', desk(3)); await two.putControl('desk', desk(7));
  const combined = await CombinedWorkspace.open([{ id: 'google:a', workspace: cloud, storage: two }, { id: 'local', workspace: local, storage: one }]);
  assert.equal(combined.layout.state.mainView, 'list');
  assert.equal((await one.getControl('desk')).mainView, 'list', 'the behind copy catches up, so signing out next still finds it');
});

test('a group new to this device that finds no free region is reported once; one with a region is not', async () => {
  const { combined, profiles } = await open(['google:a', 'local']);
  assert.deepEqual(combined.layout.takeArrivedOffDesktop(), [], 'the first groups found regions');
  const added = []; for (let index = 0; index < 8; index++) added.push(await combined.createGroup(`More ${index}`, profiles[index % 2].id));
  await combined.layout.settle();
  const off = added.filter(group => combined.layout.state.hiddenGroups[group.id]).map(group => group.id);
  assert.equal(off.length, 1, 'nine regions fit nine of the ten groups');
  assert.deepEqual(combined.layout.takeArrivedOffDesktop(), off); assert.deepEqual(combined.layout.takeArrivedOffDesktop(), []);
  await combined.layout.settle(); assert.deepEqual(combined.layout.takeArrivedOffDesktop(), [], 'it stays off without saying so again');
});

test('Versions and conflicts opens on a collection that has something to show', () => {
  const state = conflicts => ({ state: { conflicts, drafts: {} } });
  const combined = new CombinedWorkspace([{ id: 'google:a', workspace: state([]) }, { id: 'local', workspace: state([{}]) }], null);
  assert.equal(combined.attentionCount(), 1); assert.equal(combined.firstNeedingAttention(), 'local');
  assert.equal(new CombinedWorkspace([{ id: 'local', workspace: state([]) }], null).firstNeedingAttention(), null);
});

test('a collection whose desk copy cannot be read or written does not stop the others opening', async () => {
  for (const trouble of ['read', 'write']) {
    const good = controls(); const bad = controls();
    const local = await Workspace.create({ profileId: 'local', deviceId: 'device', area, persist: async () => {} });
    const cloud = await Workspace.create({ profileId: 'google:a', deviceId: 'device', area, persist: async () => {}, bootstrapGroup: false });
    await good.putControl('desk', { revision: 3, grid: { rows: 1, columns: 3, area, slots: [null, null, null] }, groupColors: {}, known: {} });
    bad[trouble === 'read' ? 'getControl' : 'putControl'] = async () => { throw new Error('storage trouble'); };
    const combined = await CombinedWorkspace.open([{ id: 'google:a', workspace: cloud, storage: bad }, { id: 'local', workspace: local, storage: good }]);
    assert.ok(activeGroups(combined.snapshot).length, `it opens with ${trouble} failing`);
    await combined.layout.setMainGroup(activeGroups(combined.snapshot)[0].id);
    assert.ok((await good.getControl('desk')).mainGroupId, 'the working copy still saves');
  }
});

test('a copy changed later leads even with a lower revision, as after one collection was reset', async () => {
  const one = controls(); const two = controls();
  const local = await Workspace.create({ profileId: 'local', deviceId: 'device', area, persist: async () => {} });
  const cloud = await Workspace.create({ profileId: 'google:a', deviceId: 'device', area, persist: async () => {}, bootstrapGroup: false });
  const desk = (revision, changedAt, mainView) => ({ revision, changedAt, grid: { rows: 1, columns: 3, area, slots: [null, null, null] }, groupColors: {}, known: {}, mainView });
  await one.putControl('desk', desk(2, 2000, 'list')); await two.putControl('desk', desk(7, 1000, 'board'));
  const combined = await CombinedWorkspace.open([{ id: 'google:a', workspace: cloud, storage: two }, { id: 'local', workspace: local, storage: one }]);
  assert.equal(combined.layout.state.mainView, 'list');
  assert.equal((await two.getControl('desk')).mainView, 'list');
});
