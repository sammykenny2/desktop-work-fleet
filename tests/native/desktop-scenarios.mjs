/** Synthetic projections from the actual shared interaction core. Usage: node tests/native/desktop-scenarios.mjs OUTPUT */
import { writeFile } from 'node:fs/promises';
import { Workspace } from '../../src/core/workspace.js';
import { InteractionController } from '../../src/interaction/controller.js';
import { projectDesktop } from '../../src/desktop/projection.js';

const workspace = await Workspace.create({ profileId: 'layer-probe', deviceId: crypto.randomUUID(),
  area: { x: 0, y: 0, width: 1280, height: 720 }, persist: async () => {} });
const group = workspace.snapshot.groups[0];
const other = await workspace.createGroup('Other synthetic group');
const card = await workspace.createCard({ format: 'markdown', text: '# Synthetic layer probe', attachments: [] }, group.id);
const second = await workspace.createCard({ format: 'markdown', text: 'Other group', attachments: [] }, other.id);
await workspace.layout.placeNew(workspace.snapshot, [{ x: 0, y: 0, width: 1280, height: 720 }]);
await workspace.layout.move(card.id, { x: 100, y: 100 });
await workspace.layout.move(second.id, { x: 500, y: 100 });
await workspace.layout.setGroupLayer(group.id, 'wallpaper', workspace.snapshot);
await workspace.layout.setGroupLayer(other.id, 'wallpaper', workspace.snapshot);
const controller = new InteractionController({ getSnapshot: () => workspace.working, layout: workspace.layout, commands: workspace, saveDraft: async () => {} });
const scenarios = []; const sessionId = crypto.randomUUID();
const capture = (name, notice = null) => scenarios.push({ name, primary: card.id, secondary: second.id,
  frame: projectDesktop({ snapshot: workspace.working, layout: workspace.layout.state, interaction: controller.state,
    sessionId, sequence: scenarios.length + 1, workspaceRevision: workspace.state.revision, layers: ['desktop', 'floating', 'wallpaper'], notice }) });
capture('wallpaper');
await controller.activate({ kind: 'group', groupId: group.id }); capture('operate-group');
await controller.activate({ kind: 'none' }); capture('restore-wallpaper');
// Layers belong to groups; desktop and topmost papers always take clicks and text selection while locked.
await workspace.layout.setGroupLayer(group.id, 'desktop', workspace.snapshot); capture('desktop-selectable');
await workspace.layout.setGroupLayer(group.id, 'floating', workspace.snapshot); capture('resident-floating');
await workspace.layout.setGroupLayer(group.id, 'wallpaper', workspace.snapshot); capture('wallpaper-again');
await workspace.layout.setCardPolicy(card.id, { visible: false });
await workspace.layout.setCardPolicy(second.id, { visible: false }); capture('hidden');
await workspace.layout.setCardPolicy(card.id, { visible: true }); capture('shown-again');
// With no topmost paper, a stage notice alone keeps the topmost scene up, and it never takes the mouse.
capture('notice', { id: 1, rect: { x: 700, y: 400, width: 400, height: 200 }, title: 'Synthetic layer probe', text: 'Top layer', step: 3, steps: 4 });
await writeFile(process.argv[2], JSON.stringify(scenarios) + '\n');
