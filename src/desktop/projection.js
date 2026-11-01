import { activeGroups, copy, gridRegions, summaryText, validRect, requireValue } from '../core/contracts.js';
import { groupColors } from '../core/palette.js';
import { settleGroupColors } from '../layout/colors.js';
import { groupOpacity } from '../layout/opacity.js';
import { cardPolicy, sceneOrder } from '../interaction/controller.js';
import { groupName } from '../core/group-name.js';
import { getLocale, t } from '../i18n/index.js';

/**
 * Presentation data only. Historical versions, sync cursors, outbox and credentials never enter this projection.
 * The frame carries the owner's UI locale, which every scene applies before drawing, and group names as shown.
 */
export function projectDesktop({ snapshot, layout, interaction, sessionId, sequence, workspaceRevision,
  layers = ['desktop', 'floating'], residentLayers = layers, editor = null, topology = 0, notice = null, quickMove = null }) {
  requireValue(typeof sessionId === 'string' && sessionId.length > 0 && Number.isSafeInteger(sequence) && sequence >= 0,
    'desktop-frame', t('errors.desktop.frameInvalid'));
  // A host offers the desktop layer, the wallpaper layer or both for resting papers, and may keep its topmost scene for
  // adjusted papers only. A resting paper asking for a layer it cannot rest on sits on the desktop or the wallpaper.
  requireValue(quickMove === null || ['meta', 'ctrl'].includes(quickMove), 'desktop-frame', t('errors.desktop.frameInvalid'));
  requireValue((residentLayers.includes('desktop') || residentLayers.includes('wallpaper')) && residentLayers.every(layer => layers.includes(layer))
    && layers.every(layer => ['desktop', 'floating', 'wallpaper'].includes(layer)), 'desktop-layer', t('errors.desktop.noLayer'));
  const resident = residentLayers.includes('desktop') ? 'desktop' : 'wallpaper';
  const groups = activeGroups(snapshot); const colors = settleGroupColors(layout.groupColors, groups);
  let regions = [];
  try { regions = gridRegions(layout.grid, groups); } catch { /* A group overflow must not hide existing cards. */ }
  const fallbacks = []; const cards = [];
  for (const card of sceneOrder(snapshot.cards, layout, interaction)) {
    const policy = cardPolicy(card, layout, interaction); const saved = layout.placements[card.id];
    if (!policy.visible || !saved) continue;
    const placement = interaction.dragSession?.cardId === card.id ? interaction.dragSession.position : saved;
    requireValue(validRect(placement), 'desktop-geometry', t('errors.desktop.geometryInvalid'));
    let layer = policy.layer; let { interactive, draggable, editing } = policy;
    // Adjusted and edited papers may use any scene, resting papers only the layers they can rest on.
    if (!(draggable || editing ? layers : residentLayers).includes(layer)) { fallbacks.push({ cardId: card.id, requested: layer, effective: resident }); layer = resident; }
    // Wallpaper papers always let clicks through, including desktop papers that fell back onto the wallpaper.
    if (layer === 'wallpaper') interactive = draggable = editing = false;
    cards.push({ id: card.id, groupId: card.groupId, revision: card.revision, summary: summaryText(card),
      text: card.content.text, format: card.content.format, attachmentCount: card.content.attachments?.length || 0,
      attachments: (card.content.attachments || []).map(file => ({ id: file.id, name: file.name })),
      rect: { x: placement.x, y: placement.y, width: placement.width, height: placement.height }, layer,
      interactive, draggable, editing,
      selected: interaction.selectedCardId === card.id, completed: card.completed, mine: layout.myGroupId === card.groupId,
      color: groupColors[colors[card.groupId] ?? 0],
      // Only a paper resting on the Top layer is see-through; one being adjusted or edited stays opaque.
      opacity: layer === 'floating' && !draggable && !editing ? groupOpacity(layout, card.groupId) : 1,
      // The snapshot is the working one: a paper showing unsaved changes carries a dot (ADR-061).
      unsaved: card.unsaved === true });
  }
  const projectedEditor = editor && cards.find(card => card.id === editor.cardId && card.editing)
    ? { cardId: editor.cardId, draftId: editor.draftId, viewId: editor.viewId, text: editor.text, sequence: editor.sequence } : null;
  return copy({ protocol: 1, sessionId, sequence, topology, locale: getLocale(), workspaceRevision, layoutRevision: layout.revision,
    groups: groups.map(group => ({ id: group.id, name: groupName(group), color: groupColors[colors[group.id]],
      region: regions.find(region => region.groupId === group.id) || null })),
    operationScope: interaction.operationScope, activeGroupId: interaction.activeGroupId, cards, editor: projectedEditor,
    dropTarget: interaction.dragSession?.target || null, fallbacks,
    // The key that starts a quick move on a resting paper, only while nothing is adjusted; null when it is off.
    quickMove: interaction.operationScope.kind === 'none' ? quickMove : null,
    // A short on-screen notice after a group or all-groups key, drawn by the topmost scene and never taking the mouse.
    notice: notice && { id: notice.id, rect: notice.rect, title: notice.title, text: notice.text, step: notice.step, steps: notice.steps } });
}
