import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController, cardPolicy } from '../src/interaction/controller.js';
import { projectDesktop } from '../src/desktop/projection.js';
import { adjustStage, groupLayer, groupLayersFromPapers, nextGroupStage, stepGroup } from '../src/layout/stages.js';

const area = { x: 0, y: 0, width: 1600, height: 900 };
const text = value => ({ format: 'markdown', text: value, attachments: [] });

async function fixture() {
  let counter = 0;
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area, persist: async () => {},
    uuid: () => `id-${String(++counter).padStart(4, '0')}` });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('別組');
  const a1 = await workspace.createCard(text('第一件事'), a.id); const a2 = await workspace.createCard(text('第二件事'), a.id);
  const b1 = await workspace.createCard(text('第三件事'), b.id);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout,
    commands: workspace, saveDraft: async () => {} });
  const press = (groupId = a.id, wallpaper = true) => stepGroup({ workspace, controller, groupId, wallpaper });
  return { workspace, controller, a, b, a1, a2, b1, press, layer: id => groupLayer(workspace.layout.state, id) };
}

test('four stages: wallpaper, desktop, topmost, adjust mode, and a missing wallpaper layer restarts at the desktop', () => {
  assert.equal(nextGroupStage('wallpaper'), 1); assert.equal(nextGroupStage('desktop'), 2);
  assert.equal(nextGroupStage('floating'), adjustStage); assert.equal(nextGroupStage('floating', { adjusting: true }), 0);
  assert.equal(nextGroupStage('floating', { adjusting: true, wallpaper: false }), 1);
  assert.equal(nextGroupStage('wallpaper', { wallpaper: false }), 1, 'a group already on the wallpaper still steps to the desktop');
});

test('without a desktop layer the wallpaper steps straight to the topmost layer', async () => {
  assert.equal(nextGroupStage('wallpaper', { desktop: false }), 2);
  assert.equal(nextGroupStage('desktop', { desktop: false }), 2, 'a group saved on the desktop shows on the wallpaper and steps on');
  assert.equal(nextGroupStage('floating', { desktop: false }), adjustStage);
  assert.equal(nextGroupStage('floating', { adjusting: true, desktop: false }), 0);
  const f = await fixture(); const press = () => stepGroup({ workspace: f.workspace, controller: f.controller, groupId: f.a.id, wallpaper: true, desktop: false });
  assert.equal(await press(), 2); assert.equal(f.layer(f.a.id), 'floating');
  assert.equal(await press(), adjustStage);
  assert.equal(await press(), 0); assert.equal(f.layer(f.a.id), 'wallpaper');
  assert.equal(await press(), 2); assert.equal(f.layer(f.a.id), 'floating', 'the missing desktop layer is never stored by a key');
});

test('where the topmost layer is for adjusting only, the wallpaper steps straight into adjust mode and keeps its layer', async () => {
  const options = { desktop: false, floating: false };
  assert.equal(nextGroupStage('wallpaper', options), adjustStage);
  assert.equal(nextGroupStage('desktop', options), adjustStage);
  assert.equal(nextGroupStage('floating', options), adjustStage);
  assert.equal(nextGroupStage('floating', { ...options, adjusting: true }), 0);
  const f = await fixture(); const press = () => stepGroup({ workspace: f.workspace, controller: f.controller, groupId: f.a.id, wallpaper: true, ...options });
  await f.workspace.layout.setGroupLayer(f.a.id, 'wallpaper', f.workspace.snapshot);
  assert.equal(await press(), adjustStage); assert.equal(f.layer(f.a.id), 'wallpaper', 'adjust mode never stores the topmost layer');
  assert.deepEqual(f.controller.state.operationScope, { kind: 'group', groupId: f.a.id });
  assert.equal(await press(), 0); assert.equal(f.layer(f.a.id), 'wallpaper'); assert.equal(f.controller.state.operationScope.kind, 'none');
});

test('four presses walk the group round, and only that group moves', async () => {
  const f = await fixture();
  assert.equal(f.layer(f.a.id), 'desktop', 'groups start on the desktop layer');
  assert.equal(await f.press(), 2); assert.equal(f.layer(f.a.id), 'floating');
  assert.equal(f.controller.state.operationScope.kind, 'none');
  assert.equal(await f.press(), adjustStage); assert.deepEqual(f.controller.state.operationScope, { kind: 'group', groupId: f.a.id });
  assert.equal(await f.press(), 0); assert.equal(f.layer(f.a.id), 'wallpaper'); assert.equal(f.controller.state.operationScope.kind, 'none');
  assert.equal(await f.press(), 1); assert.equal(f.layer(f.a.id), 'desktop');
  assert.equal(f.layer(f.b.id), 'desktop'); assert.deepEqual(Object.keys(f.workspace.layout.state.groupLayers), [f.a.id]);
});

test('desktop and topmost papers take clicks while locked, wallpaper papers never do', async () => {
  const f = await fixture(); const policy = card => cardPolicy(card, f.workspace.layout.state, f.controller.state);
  assert.deepEqual([policy(f.a1).layer, policy(f.a1).interactive, policy(f.a1).draggable], ['desktop', true, false]);
  await f.workspace.layout.setGroupLayer(f.a.id, 'wallpaper', f.workspace.snapshot);
  assert.deepEqual([policy(f.a1).layer, policy(f.a1).interactive], ['wallpaper', false]);
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  assert.deepEqual([policy(f.a2).layer, policy(f.a2).interactive], ['floating', true]);
  await assert.rejects(f.workspace.layout.setGroupLayer(f.a.id, 'sky', f.workspace.snapshot), error => error.code === 'invalid-setting');
  await assert.rejects(f.workspace.layout.setCardPolicy(f.a1.id, { residentLayer: 'floating' }), error => error.code === 'invalid-setting');
});

test('a group key ends adjust mode for all groups, and an empty group is refused before anything changes', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  assert.equal(await f.press(), 2); assert.equal(f.controller.state.operationScope.kind, 'none');
  const empty = await f.workspace.createGroup('空組'); const before = f.workspace.layout.state;
  await assert.rejects(f.press(empty.id), error => error.code === 'empty-scope'); assert.deepEqual(f.workspace.layout.state, before);
});

test('per-paper layers from older layouts become the lowest layer of each group, once', () => {
  const rect = (residentLayer, extra = {}) => ({ x: 0, y: 0, width: 10, height: 10, order: 1, visible: true, residentLayer, readOnlySelect: true, ...extra });
  const cards = [{ id: 'p1', groupId: 'g1' }, { id: 'p2', groupId: 'g1' }, { id: 'p3', groupId: 'g2' }, { id: 'p4', groupId: 'g3' },
    { id: 'p5', groupId: 'g3', archived: true }, { id: 'p6', groupId: 'g4' }];
  const legacy = { grid: {}, placements: { p1: rect('floating'), p2: rect('wallpaper'), p3: rect('desktop'), p4: rect('floating'),
    p5: rect('wallpaper'), p6: rect('wallpaper', { visible: false }) } };
  const migrated = groupLayersFromPapers(legacy, cards);
  assert.deepEqual(migrated.groupLayers, { g1: 'wallpaper', g3: 'floating' }, 'desktop is the default; archived and hidden papers do not count');
  assert.ok(Object.values(migrated.placements).every(value => !('residentLayer' in value) && !('readOnlySelect' in value)));
  assert.deepEqual(migrated.placements.p6, { x: 0, y: 0, width: 10, height: 10, order: 1, visible: false });
  assert.deepEqual(groupLayersFromPapers(migrated, cards), migrated);
  // A group that already has a layer keeps it when older papers arrive, as in an import.
  const imported = { ...migrated, placements: { ...migrated.placements, p7: rect('wallpaper') } };
  assert.equal(groupLayersFromPapers(imported, [...cards, { id: 'p7', groupId: 'g3' }]).groupLayers.g3, 'floating');
});

test('a workspace saved with per-paper layers opens with group layers', async () => {
  const f = await fixture(); const state = f.workspace.state;
  for (const id of [f.a1.id, f.a2.id]) Object.assign(state.layout.placements[id], { residentLayer: 'floating', readOnlySelect: false });
  delete state.layout.groupLayers;
  const opened = new Workspace(state, async () => {});
  assert.deepEqual(opened.layout.state.groupLayers, { [f.a.id]: 'floating' });
  assert.equal('residentLayer' in opened.layout.state.placements[f.a1.id], false);
  assert.deepEqual(opened.state.layout, opened.layout.state, 'workspace and layout store agree');
});

test('a stage notice travels in the desktop frame only while it is set', async () => {
  const f = await fixture();
  const project = notice => projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state, interaction: f.controller.state,
    sessionId: 'notice-test', sequence: 1, workspaceRevision: f.workspace.state.revision, notice });
  assert.equal(project(null).notice, null);
  const notice = { id: 7, rect: { x: 0, y: 0, width: 800, height: 900 }, title: '我的便箋', text: '最上層', step: 3, steps: 4 };
  assert.deepEqual(project({ ...notice, extra: 'dropped' }).notice, notice);
});
