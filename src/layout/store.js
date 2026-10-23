import { activeGroups, compareId, containsRect, copy, defaultGrid, eligible,
  gridRegions, groupKey, membershipKey, requireValue, validRect } from '../core/contracts.js';
import { defaultShortcuts, validateShortcuts } from '../core/shortcuts.js';
import { maximalAreas, overlaps, subtract } from './formation.js';
import { groupLayerOrder } from './stages.js';
import { orderedGroups } from './order.js';
import { settleGroupColors, swapGroupColor, validColor } from './colors.js';
import { validOpacity } from './opacity.js';
import { schemas } from '../core/schema.js';
import { t } from '../i18n/index.js';

/** How the main window shows a group's papers on this device; a layout without a choice shows the board. */
export const mainViews = Object.freeze(['board', 'list']);
export const mainView = layout => layout.mainView === 'list' ? 'list' : 'board';
/** The group the main window shows on this device, kept across restarts; quick capture files new notes into it. */
export const mainGroup = (layout, groups) => groups.some(group => group.id === layout.mainGroupId) ? layout.mainGroupId : groups[0]?.id;

const geometry = rect => Object.fromEntries(['x', 'y', 'width', 'height', 'order'].map(key => [key, rect[key]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLayout(deviceId, groups, area) {
  return { schemaVersion: schemas.layout, deviceId, revision: 0, grid: defaultGrid(groups, area),
    placements: {}, history: [], desktopVisible: true, myGroupId: null, shortcuts: defaultShortcuts(), groupLayers: {},
    groupColors: settleGroupColors({}, groups) };
}

export function retireGroupLayout(draft, sourceId, targetId, affectedCards) {
  const affected = new Set(affectedCards);
  draft.grid.slots = draft.grid.slots.map(id => id === sourceId ? null : id);
  if (draft.myGroupId === sourceId) draft.myGroupId = targetId;
  if (draft.mainGroupId === sourceId) draft.mainGroupId = targetId;
  // The receiving group keeps its own layer and colour; the retired group's colour is free again.
  if (draft.groupLayers) delete draft.groupLayers[sourceId];
  if (draft.groupColors) delete draft.groupColors[sourceId];
  if (draft.groupOpacity) delete draft.groupOpacity[sourceId];
  for (const key of Object.keys(draft.shortcuts)) if (draft.shortcuts[key] === sourceId) draft.shortcuts[key] = targetId;
  const oldLength = draft.history.length;
  draft.history = draft.history.filter(entry => !entry.transfer || !(affected.has(entry.transfer.cardId)
    || [entry.transfer.fromGroupId, entry.transfer.toGroupId].includes(sourceId)));
  return { movedCards: affected.size, retiredGroupId: sourceId, removedUndo: oldLength - draft.history.length };
}

export function recordTransferLayout(draft, cardId, position, transfer) {
  const rect = draft.placements[cardId];
  requireValue(rect || !position, 'missing-placement', t('errors.core.placementMissing'));
  draft.history.push({ kind: 'transfer', before: rect ? { [cardId]: geometry(rect) } : {}, transfer: copy(transfer) });
  if (position) {
    requireValue(Number.isFinite(position.x) && Number.isFinite(position.y), 'invalid-position', t('errors.core.positionInvalid'));
    Object.assign(rect, { x: position.x, y: position.y });
  }
}

// Only an inaccessible title is rescued. Large, intentionally overflowing papers keep their size.
export function reachable(rect, workAreas) {
  return workAreas.some(area => containsRect(area, {
    x: rect.x, y: rect.y, width: Math.min(64, rect.width), height: Math.min(28, rect.height),
  }));
}

export function rescueRect(rect, workAreas) {
  requireValue(workAreas.length && workAreas.every(validRect), 'invalid-area', t('errors.core.noDisplay'));
  if (reachable(rect, workAreas)) return copy(rect);
  const distance = area => Math.max(area.x - rect.x, 0, rect.x - area.x - area.width) ** 2
    + Math.max(area.y - rect.y, 0, rect.y - area.y - area.height) ** 2;
  const area = [...workAreas].sort((a, b) => distance(a) - distance(b))[0];
  return { ...rect, x: Math.max(area.x, Math.min(rect.x, area.x + Math.max(0, area.width - rect.width))),
    y: Math.max(area.y, Math.min(rect.y, area.y + Math.max(0, area.height - rect.height))) };
}

// A new paper keeps its shape but shrinks until it fits its group's region inside the 12px margin that stacking and
// spreading keep, so a 3 × 3 grid on a short screen still holds one paper per region. It never shrinks below 160px.
function fitNewPaper(size, region, margin = 12, smallest = 160) {
  const fit = Math.min(1, (region.width - 2 * margin) / size.width, (region.height - 2 * margin) / size.height);
  const scale = Math.max(fit, Math.min(1, smallest / Math.min(size.width, size.height)));
  // The epsilon keeps 240 × (234 / 240) from flooring to 233.
  return { width: Math.floor(size.width * scale + 1e-9), height: Math.floor(size.height * scale + 1e-9) };
}

// A new paper takes the first free place in its group's region, row by row from the top left as a spread fills it,
// keeping the 12px margin from the region's edge and from every paper shown on the desktop, whatever its group. In a
// full region it cascades from the region's corner in 18 × 28 steps and takes the first step with no shown paper's corner
// within one step, so it never hides another paper's title band corner; when every step has one, the step farthest away.
function newPaperPosition(size, region, shown, margin = 12, step = { x: 18, y: 28 }) {
  const corner = { x: region.x + margin, y: region.y + margin };
  const bounds = { ...corner, width: region.width - 2 * margin, height: region.height - 2 * margin };
  let free = validRect(bounds) ? [bounds] : [];
  for (const rect of shown) {
    if (!free.length) break;
    const blocked = { x: rect.x - margin, y: rect.y - margin, width: rect.width + 2 * margin, height: rect.height + 2 * margin };
    if (free.some(area => overlaps(area, blocked))) free = maximalAreas(free.flatMap(area => subtract(area, blocked)));
  }
  const spot = free.filter(area => area.width + 0.001 >= size.width && area.height + 0.001 >= size.height)
    .sort((a, b) => a.y - b.y || a.x - b.x)[0];
  if (spot) return { x: spot.x, y: spot.y };
  let best = corner; let farthest = -1;
  for (let index = 0; index < 40; index++) {
    const trial = { x: corner.x + index * step.x, y: corner.y + index * step.y };
    if (!containsRect(region, { ...trial, ...size })) break;
    // Measured in cascade steps to the nearest shown paper's corner.
    const distance = Math.min(...shown.map(rect => Math.max(Math.abs(rect.x - trial.x) / step.x, Math.abs(rect.y - trial.y) / step.y)));
    if (distance >= 1) return trial;
    if (distance > farthest) { best = trial; farthest = distance; }
  }
  return best;
}

/** Single writer per device; persist must atomically save the full supplied snapshot or reject. */
export class LayoutStore {
  #state;
  #persist;
  #tail = Promise.resolve();

  constructor(state, persist) {
    requireValue(typeof persist === 'function', 'missing-storage', t('errors.core.layoutStorageRequired'));
    this.#state = copy(state);
    this.#persist = persist;
  }

  get state() { return copy(this.#state); }

  /** Serialize a source transaction with device writes; the callback atomically persists both states. */
  integrateSource(persist) {
    const operation = this.#tail.then(async () => {
      const { layout, value } = await persist(copy(this.#state), this.#state.revision);
      this.#state = copy(layout);
      return copy(value);
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  #transaction(change, persist = this.#persist, force = false) {
    const operation = this.#tail.then(async () => {
      const draft = copy(this.#state);
      const result = await change(draft);
      if (!force && same(draft, this.#state)) return result;
      draft.revision = this.#state.revision + 1;
      await persist(copy(draft), this.#state.revision, result);
      this.#state = draft;
      return result;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  async configure(patch, snapshot) {
    patch = copy(patch); snapshot = copy(snapshot);
    const allowed = ['grid', 'desktopVisible', 'completedVisible', 'quickMove', 'myGroupId', 'shortcuts', 'mainView'];
    requireValue(Object.keys(patch).every(key => allowed.includes(key)), 'invalid-setting', t('errors.core.layoutSettingUnknown'));
    if (patch.grid) gridRegions(patch.grid, activeGroups(snapshot));
    requireValue(['desktopVisible', 'completedVisible', 'quickMove'].every(key => !(key in patch) || typeof patch[key] === 'boolean'),
      'invalid-setting', t('errors.core.visibilityInvalid'));
    requireValue(!('myGroupId' in patch) || patch.myGroupId === null || activeGroups(snapshot).some(group => group.id === patch.myGroupId),
      'invalid-group-setting', t('errors.core.myGroupMissing'));
    if ('shortcuts' in patch) patch.shortcuts = validateShortcuts(patch.shortcuts, activeGroups(snapshot));
    requireValue(!('mainView' in patch) || mainViews.includes(patch.mainView), 'invalid-setting', t('errors.core.mainViewUnknown'));
    return this.#transaction(draft => { Object.assign(draft, copy(patch)); return { groups: groupKey(snapshot) }; });
  }

  async setCardPolicy(cardId, patch) {
    patch = copy(patch);
    requireValue(Object.keys(patch).every(key => key === 'visible'), 'invalid-setting', t('errors.core.noteSettingUnknown'));
    requireValue(!('visible' in patch) || typeof patch.visible === 'boolean', 'invalid-setting', t('errors.core.visibilityInvalid'));
    return this.#transaction(draft => {
      requireValue(draft.placements[cardId], 'missing-placement', t('errors.core.placementMissing'));
      Object.assign(draft.placements[cardId], copy(patch));
    });
  }

  /**
   * Remembers the group the main window shows. A sync that changes the groups meanwhile does not refuse the choice:
   * a merge or redirect carries it on, and a group that is gone falls back to the first one when read.
   */
  async setMainGroup(groupId, snapshot) {
    requireValue(activeGroups(copy(snapshot)).some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    return this.#transaction(draft => { draft.mainGroupId = groupId; });
  }

  /** The layer belongs to the group on this device; every paper of the group follows it. */
  async setGroupLayer(groupId, layer, snapshot) {
    requireValue(groupLayerOrder.includes(layer), 'invalid-setting', t('errors.core.layerUnknown'));
    requireValue(activeGroups(copy(snapshot)).some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    return this.#transaction(draft => { draft.groupLayers = { ...draft.groupLayers, [groupId]: layer }; });
  }

  /** The colour belongs to the group on this device; a group already wearing it takes the colour this one gives up. */
  async setGroupColor(groupId, index, snapshot) {
    const groups = activeGroups(copy(snapshot));
    requireValue(validColor(index), 'invalid-setting', t('errors.core.colorUnknown'));
    requireValue(groups.some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    return this.#transaction(draft => { draft.groupColors = swapGroupColor(settleGroupColors(draft.groupColors, groups), groupId, index); });
  }

  /** How see-through the group's Top-layer papers are on this device; fully opaque removes the entry. */
  async setGroupOpacity(groupId, value, snapshot) {
    requireValue(validOpacity(value), 'invalid-setting', t('errors.core.opacityInvalid'));
    requireValue(activeGroups(copy(snapshot)).some(group => group.id === groupId), 'missing-group', t('errors.common.groupMissing'));
    const rounded = Math.round(value * 100) / 100;
    return this.#transaction(draft => {
      const next = { ...draft.groupOpacity };
      if (rounded === 1) delete next[groupId]; else next[groupId] = rounded;
      draft.groupOpacity = next;
    });
  }

  // New papers are square, like the familiar 3 × 3 in sticky note, and smaller only where their region is shorter;
  // papers already placed keep their size.
  async placeNew(snapshot, workAreas, paperSize = { width: 240, height: 240 }, checkpoint = null) {
    snapshot = copy(snapshot); workAreas = copy(workAreas); paperSize = copy(paperSize);
    requireValue(paperSize.width > 0 && paperSize.height > 0, 'invalid-size', t('errors.core.paperSizeInvalid'));
    return this.#transaction(async draft => {
      const groups = activeGroups(snapshot);
      const gridIds = draft.grid.slots.filter(Boolean);
      if (groups.length <= 9 && (groups.length !== gridIds.length || groups.some(group => !gridIds.includes(group.id)))) {
        // Region bookkeeping does not move papers already on the desktop, and groups keep the order they had.
        draft.grid = defaultGrid(orderedGroups(draft, groups), draft.grid.area);
      }
      const knownIds = new Set(groups.map(group => group.id));
      const regionGroups = groups.filter(group => gridIds.includes(group.id));
      const regions = groups.length <= 9 ? gridRegions(draft.grid, groups)
        : gridRegions(draft.grid, regionGroups);
      const deferred = [];
      let order = Math.max(0, ...Object.values(draft.placements).map(rect => rect.order)) + 1;
      const fresh = snapshot.cards.filter(card => !card.deleted && !draft.placements[card.id])
        .sort((a, b) => compareId(a.id, b.id));
      // Placements outlive deleted, archived and hidden papers; only papers on the desktop take up room.
      const shown = snapshot.cards.filter(card => draft.placements[card.id] && eligible(card, draft))
        .map(card => draft.placements[card.id]);
      for (const card of fresh) {
        if (checkpoint) await checkpoint();
        if (!knownIds.has(card.groupId)) { deferred.push(card.id); continue; }
        const region = regions.find(region => region.groupId === card.groupId) || draft.grid.area;
        const size = fitNewPaper(paperSize, region);
        draft.placements[card.id] = rescueRect({ ...newPaperPosition(size, region, shown), ...size, order: order++, visible: true }, workAreas);
        if (eligible(card, draft)) shown.push(draft.placements[card.id]);
      }
      return { deferred, groupOverflow: groups.length > 9, groups: groupKey(snapshot) };
    });
  }

  async move(cardId, position, expectedRevision) {
    position = copy(position);
    requireValue(Number.isFinite(position.x) && Number.isFinite(position.y), 'invalid-position', t('errors.core.positionInvalid'));
    return this.#transaction(draft => {
      requireValue(expectedRevision === undefined || expectedRevision === draft.revision, 'stale-layout', t('errors.common.layoutChanged'));
      const rect = draft.placements[cardId];
      requireValue(rect, 'missing-placement', t('errors.core.placementMissing'));
      if (rect.x === position.x && rect.y === position.y) return;
      draft.history.push({ kind: 'move', before: { [cardId]: geometry(rect) } });
      Object.assign(rect, { x: position.x, y: position.y });
    });
  }

  async transfer(cardId, position, expectedRevision, transfer, persist) {
    position = copy(position); transfer = copy(transfer);
    return this.#transaction(draft => {
      requireValue(expectedRevision === undefined || expectedRevision === draft.revision, 'stale-layout', t('errors.common.layoutChanged'));
      recordTransferLayout(draft, cardId, position, transfer);
    }, persist);
  }

  async retireGroup(sourceId, targetId, affectedCards, persist) {
    affectedCards = copy(affectedCards);
    return this.#transaction(draft => retireGroupLayout(draft, sourceId, targetId, affectedCards), persist, true);
  }

  async applyFormation(plan, getSnapshot) {
    plan = copy(plan);
    return this.#transaction(draft => {
      requireValue(plan.layoutRevision === draft.revision
        && plan.membership === membershipKey(getSnapshot(), draft),
      'stale-plan', t('errors.core.arrangePlanStale'));
      requireValue(plan.allowResize || plan.resized.length === 0, 'resize-consent', t('errors.core.resizeNotAllowed'));
      const before = {};
      for (const [id, rect] of Object.entries(plan.changes)) {
        before[id] = geometry(draft.placements[id]);
        Object.assign(draft.placements[id], geometry(rect));
      }
      draft.history.push({ kind: 'formation', before, gridBefore: copy(draft.grid), gridAfter: copy(plan.grid) });
      draft.grid = copy(plan.grid);
      return { membership: plan.membership };
    });
  }

  async undo(getSnapshot, workAreas, persist, undoRevision) {
    workAreas = copy(workAreas);
    return this.#transaction(draft => {
      const entry = draft.history.at(-1);
      if (!entry) return { kind: 'empty', rescued: [] };
      requireValue(entry.kind !== 'transfer' || persist, 'conditional-undo', t('errors.core.undoMoveNeedsSource'));
      const snapshot = getSnapshot();
      const live = new Set(snapshot.cards.filter(card => !card.deleted).map(card => card.id));
      const rescued = [];
      for (const [id, previous] of Object.entries(entry.before)) {
        if (!live.has(id) || !draft.placements[id]) continue;
        const restored = rescueRect(previous, workAreas);
        if (restored.x !== previous.x || restored.y !== previous.y) rescued.push(id);
        Object.assign(draft.placements[id], restored);
      }
      if (entry.gridBefore && same(entry.gridAfter, draft.grid)) {
        // A newer settings edit or remote group change must not be undone as an old layout side effect.
        const ids = activeGroups(snapshot).map(group => group.id).sort(compareId);
        if (same(entry.gridBefore.slots.filter(Boolean).sort(compareId), ids)) draft.grid = entry.gridBefore;
      }
      draft.history.pop();
      if (entry.transfer && undoRevision) {
        const earlier = draft.history.findLast(item => item.transfer?.cardId === entry.transfer.cardId);
        if (earlier?.transfer.expectedRevision === entry.transfer.previousRevision) earlier.transfer.expectedRevision = undoRevision;
      }
      return { kind: entry.kind, rescued, transfer: entry.transfer };
    }, persist);
  }

  /**
   * Resets this device's desktop layout: default group regions in the current group order, no placements or undo
   * history, papers shown, completed papers hidden, every group on the given back layer (the desktop layer when none
   * is given) and no highlighted group. Shortcuts, group colours and the device identity stay. Callers re-place papers
   * with placeNew afterwards; a crash in between leaves papers unplaced, which the start-up placeNew already repairs.
   */
  async reset(snapshot, area, layer = null) {
    snapshot = copy(snapshot); area = copy(area);
    requireValue(validRect(area), 'invalid-area', t('errors.core.noDisplay'));
    requireValue(layer === null || groupLayerOrder.includes(layer), 'invalid-setting', t('errors.core.layerUnknown'));
    return this.#transaction(draft => {
      const groups = activeGroups(snapshot);
      // More than nine groups have no default grid; keep the regions and still clear every paper position.
      draft.grid = groups.length <= 9 ? defaultGrid(orderedGroups(draft, groups), area) : { ...draft.grid, area };
      const groupLayers = layer ? Object.fromEntries(groups.map(group => [group.id, layer])) : {};
      Object.assign(draft, { placements: {}, history: [], desktopVisible: true, myGroupId: null, groupLayers });
      delete draft.completedVisible; delete draft.quickMove;
    });
  }

  /**
   * Rescues only papers whose title can no longer be reached. The group regions are laid on the primary work area, as
   * settings lay them, so they follow it when it grows as well as when it shrinks; papers inside them do not move.
   */
  async recoverDisplays(workAreas, primary) {
    workAreas = copy(workAreas);
    requireValue(validRect(primary), 'invalid-area', t('errors.core.noDisplay'));
    const { x, y, width, height } = primary;
    return this.#transaction(draft => {
      const rescued = [];
      for (const [id, rect] of Object.entries(draft.placements)) {
        if (reachable(rect, workAreas)) continue;
        draft.placements[id] = rescueRect(rect, workAreas);
        rescued.push(id);
      }
      draft.grid.area = { x, y, width, height };
      return { reason: 'display-unreachable', rescued };
    });
  }
}
