import { activeGroups, copy, gridRegions, summaryText, validRect, requireValue } from '../core/contracts.js';
import { cardPolicy, sceneOrder } from '../interaction/controller.js';

export const groupColors = Object.freeze(['#fff6cc', '#e7f2e7', '#e5edf8', '#f7e7de', '#eee8f7', '#e2f0ef', '#f6e5ec', '#f1eddb', '#e7eaf1']);

/** Presentation data only. Historical versions, sync cursors, outbox and credentials never enter this projection. */
export function projectDesktop({ snapshot, layout, interaction, sessionId, sequence, workspaceRevision,
  layers = ['desktop', 'floating'], residentLayers = layers, editor = null, topology = 0, notice = null }) {
  requireValue(typeof sessionId === 'string' && sessionId.length > 0 && Number.isSafeInteger(sequence) && sequence >= 0,
    'desktop-frame', '桌面畫面身分無效。');
  // A host offers the desktop layer, the wallpaper layer or both for resting papers, and may keep its topmost scene for
  // adjusted papers only. A resting paper asking for a layer it cannot rest on sits on the desktop or the wallpaper.
  requireValue((residentLayers.includes('desktop') || residentLayers.includes('wallpaper')) && residentLayers.every(layer => layers.includes(layer))
    && layers.every(layer => ['desktop', 'floating', 'wallpaper'].includes(layer)), 'desktop-layer', '桌面主機沒有可用的呈現層。');
  const resident = residentLayers.includes('desktop') ? 'desktop' : 'wallpaper';
  const groups = activeGroups(snapshot); const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
  let regions = [];
  try { regions = gridRegions(layout.grid, groups); } catch { /* A group overflow must not hide existing cards. */ }
  const fallbacks = []; const cards = [];
  for (const card of sceneOrder(snapshot.cards, layout, interaction)) {
    const policy = cardPolicy(card, layout, interaction); const saved = layout.placements[card.id];
    if (!policy.visible || !saved) continue;
    const placement = interaction.dragSession?.cardId === card.id ? interaction.dragSession.position : saved;
    requireValue(validRect(placement), 'desktop-geometry', '桌面卡片的位置或尺寸無效，尚未更新畫面。');
    let layer = policy.layer; let { interactive, draggable, editing } = policy;
    // Only adjusted papers are draggable; they may use any scene, resting papers only the layers they can rest on.
    if (!(draggable ? layers : residentLayers).includes(layer)) { fallbacks.push({ cardId: card.id, requested: layer, effective: resident }); layer = resident; }
    // Wallpaper papers always let clicks through, including desktop papers that fell back onto the wallpaper.
    if (layer === 'wallpaper') interactive = draggable = editing = false;
    cards.push({ id: card.id, groupId: card.groupId, revision: card.revision, summary: summaryText(card),
      text: card.content.text, format: card.content.format, attachmentCount: card.content.attachments?.length || 0,
      rect: { x: placement.x, y: placement.y, width: placement.width, height: placement.height }, layer,
      interactive, draggable, editing,
      selected: interaction.selectedCardId === card.id, completed: card.completed, mine: layout.myGroupId === card.groupId,
      color: groupColors[(groupIndex.get(card.groupId) ?? 0) % groupColors.length] });
  }
  const projectedEditor = editor && cards.find(card => card.id === editor.cardId && card.editing)
    ? { cardId: editor.cardId, draftId: editor.draftId, viewId: editor.viewId, text: editor.text, sequence: editor.sequence } : null;
  return copy({ protocol: 1, sessionId, sequence, topology, workspaceRevision, layoutRevision: layout.revision,
    groups: groups.map((group, index) => ({ id: group.id, name: group.name, color: groupColors[index % groupColors.length],
      region: regions.find(region => region.groupId === group.id) || null })),
    operationScope: interaction.operationScope, activeGroupId: interaction.activeGroupId, cards, editor: projectedEditor,
    dropTarget: interaction.dragSession?.target || null, fallbacks,
    // A short on-screen notice after a group or all-groups key, drawn by the topmost scene and never taking the mouse.
    notice: notice && { id: notice.id, rect: notice.rect, title: notice.title, text: notice.text, step: notice.step, steps: notice.steps } });
}
