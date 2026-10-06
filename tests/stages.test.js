import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController } from '../src/interaction/controller.js';
import { adjustStage, nextGroupStage, paperStage, stepGroup } from '../src/layout/stages.js';

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
  const stageOf = id => paperStage(workspace.layout.state.placements[id]);
  return { workspace, controller, a, b, a1, a2, b1, stageOf };
}

test('a group moves on from its lowest paper, skips a missing wallpaper layer and restarts after adjust mode', () => {
  const at = (residentLayer, readOnlySelect = false) => ({ residentLayer, readOnlySelect });
  assert.equal(nextGroupStage([at('floating'), at('wallpaper')]), 1);
  assert.equal(nextGroupStage([at('desktop'), at('floating')]), 2);
  assert.equal(nextGroupStage([at('desktop', true), at('floating')]), 3);
  assert.equal(nextGroupStage([at('floating', true)]), adjustStage);
  assert.equal(nextGroupStage([at('floating', true)], { adjusting: true }), 0);
  assert.equal(nextGroupStage([at('wallpaper')], { wallpaper: false }), 2, 'wallpaper papers already show on the desktop layer');
  assert.equal(nextGroupStage([at('floating', true)], { adjusting: true, wallpaper: false }), 1);
  assert.throws(() => nextGroupStage([]), error => error.code === 'empty-scope');
});

test('five presses walk the whole group through every stage and leave other groups alone', async () => {
  const f = await fixture(); const other = f.workspace.layout.state.placements[f.b1.id];
  const press = () => stepGroup({ workspace: f.workspace, controller: f.controller, groupId: f.a.id, wallpaper: true });
  const placement = id => f.workspace.layout.state.placements[id];
  assert.equal(f.stageOf(f.a1.id), 1, 'new papers start on the desktop layer');
  assert.equal(await press(), 2); assert.deepEqual([placement(f.a1.id).residentLayer, placement(f.a1.id).readOnlySelect], ['desktop', true]);
  assert.equal(await press(), 3); assert.equal(placement(f.a2.id).residentLayer, 'floating');
  assert.equal(f.controller.state.operationScope.kind, 'none');
  assert.equal(await press(), adjustStage); assert.deepEqual(f.controller.state.operationScope, { kind: 'group', groupId: f.a.id });
  assert.equal(await press(), 0); assert.equal(f.controller.state.operationScope.kind, 'none');
  assert.deepEqual([f.stageOf(f.a1.id), f.stageOf(f.a2.id)], [0, 0]);
  assert.equal(await press(), 1);
  assert.deepEqual(f.workspace.layout.state.placements[f.b1.id], other);
});

test('a mixed group is unified from its lowest paper, and a group key ends adjust mode for all groups', async () => {
  const f = await fixture();
  await f.workspace.layout.setCardPolicy(f.a1.id, { residentLayer: 'floating', readOnlySelect: true });
  await f.workspace.layout.setCardPolicy(f.a2.id, { residentLayer: 'wallpaper' });
  await f.controller.activate({ kind: 'all' });
  assert.equal(await stepGroup({ workspace: f.workspace, controller: f.controller, groupId: f.a.id, wallpaper: true }), 1);
  assert.deepEqual([f.stageOf(f.a1.id), f.stageOf(f.a2.id)], [1, 1]);
  assert.equal(f.controller.state.operationScope.kind, 'none');
});

test('a group policy change is one transaction: a missing paper leaves every paper unchanged', async () => {
  const f = await fixture(); const before = f.workspace.layout.state;
  await assert.rejects(f.workspace.layout.setCardsPolicy([f.a1.id, 'missing'], { residentLayer: 'floating' }), error => error.code === 'missing-placement');
  assert.deepEqual(f.workspace.layout.state, before);
});
