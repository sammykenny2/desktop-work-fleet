import { eligible, requireValue } from '../core/contracts.js';

/**
 * Each group sits on one desktop layer, kept per device. A group key steps it through the wallpaper, the desktop and
 * the topmost layer, then into adjust mode; the press after adjust mode starts again at the wallpaper. Papers on the
 * desktop and topmost layers take clicks and text selection, wallpaper papers never do; a desktop without the desktop
 * layer shows desktop papers on the wallpaper. Adjust mode is the interaction scope and is never stored.
 */
export const groupLayerOrder = Object.freeze(['wallpaper', 'desktop', 'floating']);
export const adjustStage = groupLayerOrder.length;
export const groupLayer = (layout, groupId) => layout.groupLayers?.[groupId] ?? 'desktop';

/**
 * Where the desktop has no wallpaper layer the cycle restarts at the desktop; a group already on the wallpaper still steps on.
 * Where it has no desktop layer the wallpaper steps straight to the topmost layer.
 */
export function nextGroupStage(layer, { adjusting = false, wallpaper = true, desktop = true } = {}) {
  if (adjusting) return wallpaper ? 0 : 1;
  const stage = groupLayerOrder.indexOf(layer) + 1;
  return stage === 1 && !desktop ? 2 : stage;
}

/** Moves the group one stage on and returns the stage it reached. */
export async function stepGroup({ workspace, controller, groupId, wallpaper, desktop = true }) {
  const layout = workspace.layout.state; const scope = controller.state.operationScope;
  requireValue(workspace.snapshot.cards.some(card => card.groupId === groupId && eligible(card, layout) && layout.placements[card.id]),
    'empty-scope', '這個群組沒有桌面便箋，請在主畫面管理顯示卡片。');
  const stage = nextGroupStage(groupLayer(layout, groupId), { adjusting: scope.kind === 'group' && scope.groupId === groupId, wallpaper, desktop });
  // The layer changes before adjust mode does, so leaving adjust mode drops papers straight onto their new layer.
  await workspace.layout.setGroupLayer(groupId, groupLayerOrder[Math.min(stage, adjustStage - 1)], workspace.snapshot);
  if (stage === adjustStage) await controller.activate({ kind: 'group', groupId });
  else if (scope.kind !== 'none') await controller.activate({ kind: 'none' });
  return stage;
}

/**
 * Older layouts kept a layer and a text-selection switch on every paper. A group without a layer takes the lowest layer
 * among its shown papers, and the per-paper fields go. Running it again changes nothing.
 */
export function groupLayersFromPapers(layout, cards) {
  const shown = new Map(cards.filter(card => !card.deleted && !card.archived).map(card => [card.id, card.groupId]));
  const result = { ...layout, groupLayers: { ...layout.groupLayers }, placements: {} }; const lowest = {};
  for (const [id, { residentLayer, readOnlySelect, ...rect }] of Object.entries(layout.placements)) {
    result.placements[id] = rect;
    const groupId = shown.get(id); const rank = groupLayerOrder.indexOf(residentLayer);
    if (groupId && rect.visible !== false && rank >= 0 && (lowest[groupId] === undefined || rank < lowest[groupId])) lowest[groupId] = rank;
  }
  for (const [groupId, rank] of Object.entries(lowest)) {
    if (!Object.hasOwn(result.groupLayers, groupId) && groupLayerOrder[rank] !== 'desktop') result.groupLayers[groupId] = groupLayerOrder[rank];
  }
  return result;
}
