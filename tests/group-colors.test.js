import test from 'node:test';
import assert from 'node:assert/strict';
import { settleGroupColors, swapGroupColor } from '../src/layout/colors.js';
import { groupColors } from '../src/core/palette.js';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController } from '../src/interaction/controller.js';
import { projectDesktop } from '../src/desktop/projection.js';
import { revisionRecord } from '../src/sources/revisions.js';
import { reorderSlots } from '../src/layout/order.js';

const groups = ids => ids.map(id => ({ id }));
const area = { x: 0, y: 0, width: 1600, height: 900 };

test('groups without a colour take the colour of their place, as before colours were stored', () => {
  assert.deepEqual(settleGroupColors(undefined, groups(['a', 'b', 'c'])), { a: 0, b: 1, c: 2 });
  assert.deepEqual(settleGroupColors({}, groups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).i, 8);
});

test('stored colours stay put when other groups go, and a new group takes a freed colour', () => {
  // b was merged away: c keeps its colour instead of moving up to b's.
  const kept = settleGroupColors({ a: 0, b: 1, c: 2 }, groups(['a', 'c']));
  assert.deepEqual(kept, { a: 0, c: 2 });
  // The next group's own place (2) is taken, so it takes the first free colour, the one b gave up.
  assert.deepEqual(settleGroupColors(kept, groups(['a', 'c', 'd'])), { a: 0, c: 2, d: 1 });
});

test('invalid or doubled stored colours are replaced, and past nine groups colours repeat', () => {
  assert.deepEqual(settleGroupColors({ a: 4, b: 4, c: 9, d: 1.5 }, groups(['a', 'b', 'c', 'd'])), { a: 4, b: 1, c: 2, d: 3 });
  const ten = settleGroupColors({}, groups(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']));
  assert.equal(ten.j, 0);
  assert.equal(new Set(Object.values(ten)).size, 9);
});

test('choosing a colour swaps it with the group that held it; a free colour moves no other group', () => {
  assert.deepEqual(swapGroupColor({ a: 0, b: 1, c: 2 }, 'a', 2), { a: 2, b: 1, c: 0 });
  assert.deepEqual(swapGroupColor({ a: 0, b: 1 }, 'a', 5), { a: 5, b: 1 });
  assert.deepEqual(swapGroupColor({ a: 0, b: 1 }, 'a', 0), { a: 0, b: 1 });
});

async function fixture() {
  let counter = 0; let disk;
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area,
    persist: async state => { disk = structuredClone(state); }, uuid: () => `id-${String(++counter).padStart(4, '0')}` });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('B'); const c = await workspace.createGroup('C');
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  return { workspace, a, b, c, disk: () => structuredClone(disk) };
}

test('each group stores its colour; a merged group frees it and the next new group takes it', async () => {
  const f = await fixture();
  assert.deepEqual(f.workspace.layout.state.groupColors, { [f.a.id]: 0, [f.b.id]: 1, [f.c.id]: 2 });
  assert.deepEqual(f.disk().layout.groupColors, f.workspace.layout.state.groupColors);
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.b.id, f.a.id));
  assert.deepEqual(f.workspace.layout.state.groupColors, { [f.a.id]: 0, [f.c.id]: 2 }, 'C keeps its colour when B goes');
  const d = await f.workspace.createGroup('D');
  assert.equal(f.workspace.layout.state.groupColors[d.id], 1, 'D takes the colour B gave up');
});

test('choosing a worn colour swaps it, persists and reaches the desktop frame', async () => {
  const f = await fixture();
  const card = await f.workspace.createCard({ format: 'markdown', text: 'Colour', attachments: [] }, f.a.id);
  await f.workspace.layout.placeNew(f.workspace.snapshot, [area]);
  await f.workspace.layout.setGroupColor(f.a.id, 2, f.workspace.snapshot);
  assert.deepEqual(f.disk().layout.groupColors, { [f.a.id]: 2, [f.b.id]: 1, [f.c.id]: 0 });
  const controller = new InteractionController({ getSnapshot: () => f.workspace.snapshot, layout: f.workspace.layout, commands: f.workspace });
  const frame = projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state, interaction: controller.state,
    sessionId: 'session', sequence: 0, workspaceRevision: 0 });
  assert.equal(frame.cards.find(item => item.id === card.id).color, groupColors[2]);
  assert.deepEqual(frame.groups.map(group => group.color), [groupColors[2], groupColors[1], groupColors[0]]);
  await assert.rejects(f.workspace.layout.setGroupColor(f.a.id, 9, f.workspace.snapshot), error => error.code === 'invalid-setting');
  await assert.rejects(f.workspace.layout.setGroupColor('missing', 1, f.workspace.snapshot), error => error.code === 'missing-group');
});

test('a layout saved before colours were stored opens with the colours its groups already showed', async () => {
  const f = await fixture(); const saved = f.disk(); delete saved.layout.groupColors;
  const reopened = new Workspace(saved, async () => {});
  assert.deepEqual(reopened.layout.state.groupColors, { [f.a.id]: 0, [f.b.id]: 1, [f.c.id]: 2 });
});

test('a group first received from sync takes a free colour without repainting the others', async () => {
  const f = await fixture(); await f.workspace.layout.setGroupColor(f.c.id, 3, f.workspace.snapshot);
  const session = await f.workspace.beginSync('drive:account-a:app-data');
  await f.workspace.receiveRevisions([revisionRecord('group', { id: 'remote', revision: 'remote-root', name: 'Remote', deleted: false })],
    { session, expectedCursor: null, cursor: 'one' });
  assert.deepEqual(f.workspace.layout.state.groupColors, { [f.a.id]: 0, [f.b.id]: 1, [f.c.id]: 3, remote: 2 });
});

test('settling keeps keys in list order, so an already settled map is unchanged even as JSON', () => {
  const settled = settleGroupColors({ a: 0, c: 2 }, groups(['a', 'b', 'c']));
  assert.deepEqual(Object.keys(settled), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(settleGroupColors(settled, groups(['a', 'b', 'c']))), JSON.stringify(settled));
});

test('reordering groups and resetting the desktop layout keep every colour', async () => {
  const f = await fixture(); await f.workspace.layout.setGroupColor(f.a.id, 5, f.workspace.snapshot);
  const colors = f.workspace.layout.state.groupColors;
  await f.workspace.layout.configure({ grid: reorderSlots(f.workspace.layout.state.grid, [f.c.id, f.a.id, f.b.id]) }, f.workspace.snapshot);
  assert.deepEqual(f.workspace.layout.state.groupColors, colors);
  await f.workspace.layout.reset(f.workspace.snapshot, area, 'wallpaper');
  assert.deepEqual(f.workspace.layout.state.groupColors, colors);
});
