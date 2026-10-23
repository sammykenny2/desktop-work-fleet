import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOpacity, translucent } from '../src/layout/opacity.js';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController } from '../src/interaction/controller.js';
import { projectDesktop } from '../src/desktop/projection.js';

const area = { x: 0, y: 0, width: 1600, height: 900 };

async function fixture() {
  let counter = 0; let disk;
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area,
    persist: async state => { disk = structuredClone(state); }, uuid: () => `id-${String(++counter).padStart(4, '0')}` });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('B');
  const card = await workspace.createCard({ format: 'markdown', text: 'See-through', attachments: [] }, a.id);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout, commands: workspace });
  const frame = () => projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
    sessionId: 'session', sequence: 0, workspaceRevision: 0, layers: ['wallpaper', 'desktop', 'floating'] }).cards.find(item => item.id === card.id);
  return { workspace, controller, a, b, card, frame, disk: () => structuredClone(disk) };
}

test('a group is opaque until this device sets an opacity from 30% to 100%, and 100% removes the setting', async () => {
  const f = await fixture();
  assert.equal(groupOpacity(f.workspace.layout.state, f.a.id), 1);
  await f.workspace.layout.setGroupOpacity(f.a.id, 0.55, f.workspace.snapshot);
  assert.deepEqual(f.disk().layout.groupOpacity, { [f.a.id]: 0.55 });
  for (const value of [0.2, 1.1, '0.5', Number.NaN]) {
    await assert.rejects(f.workspace.layout.setGroupOpacity(f.a.id, value, f.workspace.snapshot), error => error.code === 'invalid-setting');
  }
  await assert.rejects(f.workspace.layout.setGroupOpacity('missing', 0.5, f.workspace.snapshot), error => error.code === 'missing-group');
  await f.workspace.layout.setGroupOpacity(f.a.id, 1, f.workspace.snapshot);
  assert.deepEqual(f.disk().layout.groupOpacity, {});
});

test('only a paper resting on the Top layer is see-through; other layers and adjusted papers stay opaque', async () => {
  const f = await fixture();
  await f.workspace.layout.setGroupOpacity(f.a.id, 0.4, f.workspace.snapshot);
  for (const layer of ['wallpaper', 'desktop']) {
    await f.workspace.layout.setGroupLayer(f.a.id, layer, f.workspace.snapshot);
    assert.equal(f.frame().opacity, 1, `${layer} papers stay opaque`);
  }
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  assert.deepEqual([f.frame().layer, f.frame().opacity], ['floating', 0.4]);
  await f.controller.activate({ kind: 'group', groupId: f.a.id });
  assert.deepEqual([f.frame().draggable, f.frame().opacity], [true, 1], 'a paper being adjusted is opaque');
});

test('a merged group drops its opacity, and the paper colour takes the opacity as its alpha', async () => {
  const f = await fixture();
  await f.workspace.layout.setGroupOpacity(f.b.id, 0.5, f.workspace.snapshot);
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.b.id, f.a.id));
  assert.deepEqual(f.workspace.layout.state.groupOpacity, {});
  assert.equal(translucent('#ffe98a', 1), '#ffe98a');
  assert.equal(translucent('#ffe98a', 0.3), 'rgba(255, 233, 138, 0.3)');
});

test('a Top-layer group on a desktop that cannot rest papers there falls back opaque', async () => {
  const f = await fixture();
  await f.workspace.layout.setGroupOpacity(f.a.id, 0.4, f.workspace.snapshot);
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  const frame = projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state, interaction: f.controller.state,
    sessionId: 'session', sequence: 0, workspaceRevision: 0, layers: ['wallpaper', 'desktop', 'floating'], residentLayers: ['wallpaper', 'desktop'] });
  const card = frame.cards.find(item => item.id === f.card.id);
  assert.deepEqual([card.layer, card.opacity], ['desktop', 1]);
});
