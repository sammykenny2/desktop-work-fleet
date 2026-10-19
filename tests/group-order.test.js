import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { activeGroups } from '../src/core/contracts.js';
import { orderedGroups, reorderSlots } from '../src/layout/order.js';
import { revisionRecord } from '../src/sources/revisions.js';

const area = { x: 0, y: 0, width: 1600, height: 900 };
const ids = layout => layout.grid.slots.filter(Boolean);

async function fixture(names = ['B', 'C']) {
  let counter = 0; let disk;
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area,
    persist: async state => { disk = structuredClone(state); }, uuid: () => `id-${String(++counter).padStart(4, '0')}` });
  for (const name of names) await workspace.createGroup(name);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  return { workspace, disk: () => disk, groups: () => activeGroups(workspace.snapshot) };
}
// Drags the group list into a new order, as the sidebar does.
const reorder = (workspace, order) => workspace.layout.configure({ grid: reorderSlots(workspace.layout.state.grid, order) }, workspace.snapshot);

test('groups list in region order, and groups no region holds come last in workspace order', () => {
  const groups = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const layout = { grid: { slots: ['c', null, 'a', 'b'] } };
  assert.deepEqual(orderedGroups(layout, groups).map(group => group.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(groups.map(group => group.id), ['a', 'b', 'c', 'd'], 'the given list is not reordered in place');
});

test('reordering moves groups between the regions they hold and leaves empty regions in place', () => {
  const grid = { rows: 2, columns: 2, area, slots: ['a', null, 'b', 'c'] };
  assert.deepEqual(reorderSlots(grid, ['c', 'a', 'b']).slots, ['c', null, 'a', 'b']);
  assert.deepEqual(grid.slots, ['a', null, 'b', 'c']);
  for (const order of [['a', 'b'], ['a', 'b', 'b'], ['a', 'b', 'x']]) {
    assert.throws(() => reorderSlots(grid, order), error => error.code === 'invalid-slots');
  }
});

test('a dragged order survives a new group, a layout reset and a reopen, and moves no paper', async () => {
  const f = await fixture(); const [a, b, c] = f.groups();
  const card = await f.workspace.createCard({ format: 'markdown', text: 'Stays put', attachments: [] }, a.id);
  await f.workspace.layout.placeNew(f.workspace.snapshot, [area]);
  const placements = f.workspace.layout.state.placements;
  await reorder(f.workspace, [c.id, a.id, b.id]);
  assert.deepEqual(ids(f.workspace.layout.state), [c.id, a.id, b.id]);
  assert.deepEqual(f.workspace.layout.state.placements, placements, 'reordering regions moves no paper');
  assert.deepEqual(f.workspace.layout.state.placements[card.id], placements[card.id]);
  const d = await f.workspace.createGroup('D'); await f.workspace.layout.placeNew(f.workspace.snapshot, [area]);
  assert.deepEqual(ids(f.workspace.layout.state), [c.id, a.id, b.id, d.id], 'a new group joins at the end');
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.deepEqual(ids(f.workspace.layout.state), [c.id, a.id, b.id, d.id], 'a layout reset keeps the group order');
  assert.deepEqual(ids(new Workspace(f.disk(), async () => {}).layout.state), [c.id, a.id, b.id, d.id]);
});

test('groups arriving from sync join after the dragged order, even when the regions are rebuilt', async () => {
  const f = await fixture(); const [a, b, c] = f.groups();
  await reorder(f.workspace, [b.id, c.id, a.id]);
  const session = await f.workspace.beginSync('drive:account-a:app-data');
  await f.workspace.receiveRevisions([revisionRecord('group', { id: 'remote', revision: 'remote-root', name: 'Remote', deleted: false })],
    { session, expectedCursor: null, cursor: 'one' });
  assert.deepEqual(ids(f.workspace.layout.state), [b.id, c.id, a.id, 'remote']);
  assert.deepEqual(orderedGroups(f.workspace.layout.state, f.groups()).map(group => group.id), [b.id, c.id, a.id, 'remote']);
});
