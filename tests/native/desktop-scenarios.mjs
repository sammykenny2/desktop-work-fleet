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
await workspace.layout.setCardPolicy(card.id, { residentLayer: 'wallpaper', readOnlySelect: true });
await workspace.layout.setCardPolicy(second.id, { residentLayer: 'wallpaper' });
const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout, commands: workspace, saveDraft: async () => {} });
const scenarios = []; const sessionId = crypto.randomUUID();
const capture = name => scenarios.push({ name, primary: card.id, secondary: second.id,
  frame: projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
    sessionId, sequence: scenarios.length + 1, workspaceRevision: workspace.state.revision, layers: ['desktop', 'floating', 'wallpaper'] }) });
capture('wallpaper');
await controller.activate({ kind: 'group', groupId: group.id }); capture('operate-group');
await controller.activate({ kind: 'none' }); capture('restore-wallpaper');
await workspace.layout.setCardPolicy(card.id, { residentLayer: 'desktop', readOnlySelect: true }); capture('desktop-selectable');
await workspace.layout.setCardPolicy(card.id, { residentLayer: 'floating', readOnlySelect: false }); capture('resident-floating');
await workspace.layout.setCardPolicy(card.id, { residentLayer: 'wallpaper' }); capture('wallpaper-again');
await workspace.layout.setCardPolicy(card.id, { visible: false });
await workspace.layout.setCardPolicy(second.id, { visible: false }); capture('hidden');
await workspace.layout.setCardPolicy(card.id, { visible: true }); capture('shown-again');
await writeFile(process.argv[2], JSON.stringify(scenarios) + '\n');
