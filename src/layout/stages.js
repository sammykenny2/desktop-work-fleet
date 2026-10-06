import { eligible, requireValue } from '../core/contracts.js';

/**
 * A group key steps that group's papers through wallpaper, desktop, desktop with selectable text and topmost, then into
 * adjust mode; the press after adjust mode starts again at the wallpaper. The first four stages are stored on each
 * paper. Adjust mode is the interaction scope and is never stored.
 */
export const paperStages = Object.freeze([
  Object.freeze({ residentLayer: 'wallpaper', readOnlySelect: false }),
  Object.freeze({ residentLayer: 'desktop', readOnlySelect: false }),
  Object.freeze({ residentLayer: 'desktop', readOnlySelect: true }),
  Object.freeze({ residentLayer: 'floating', readOnlySelect: true }),
]);
export const adjustStage = paperStages.length;

export function paperStage(placement) {
  const layer = placement?.residentLayer ?? 'desktop';
  return layer === 'wallpaper' ? 0 : layer === 'floating' ? 3 : placement?.readOnlySelect === true ? 2 : 1;
}

/**
 * The group moves on from its lowest paper. Where the desktop has no wallpaper layer, wallpaper papers already show as
 * desktop papers, so the cycle starts at the desktop stage.
 */
export function nextGroupStage(placements, { adjusting = false, wallpaper = true } = {}) {
  requireValue(placements.length > 0, 'empty-scope', '這個群組沒有桌面便箋，請在主畫面管理顯示卡片。');
  const first = wallpaper ? 0 : 1;
  if (adjusting) return first;
  return Math.max(first, Math.min(...placements.map(paperStage))) + 1;
}

/** Moves the whole group one stage on and returns the stage it reached. */
export async function stepGroup({ workspace, controller, groupId, wallpaper }) {
  const layout = workspace.layout.state; const scope = controller.state.operationScope;
  const papers = workspace.snapshot.cards.filter(card => card.groupId === groupId && eligible(card, layout) && layout.placements[card.id])
    .map(card => card.id);
  const stage = nextGroupStage(papers.map(id => layout.placements[id]), { adjusting: scope.kind === 'group' && scope.groupId === groupId, wallpaper });
  // Layers change before adjust mode does, so leaving adjust mode drops papers straight to their new layer.
  await workspace.layout.setCardsPolicy(papers, paperStages[Math.min(stage, adjustStage - 1)]);
  if (stage === adjustStage) await controller.activate({ kind: 'group', groupId });
  else if (scope.kind !== 'none') await controller.activate({ kind: 'none' });
  return stage;
}
