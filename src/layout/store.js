import { activeGroups, compareId, containsRect, copy, defaultGrid,
  gridRegions, groupKey, membershipKey, requireValue, validRect } from '../core/contracts.js';
import { defaultShortcuts, validateShortcuts } from '../core/shortcuts.js';
import { groupLayerOrder } from './stages.js';

const geometry = rect => Object.fromEntries(['x', 'y', 'width', 'height', 'order'].map(key => [key, rect[key]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLayout(deviceId, groups, area) {
  return { schemaVersion: 1, deviceId, revision: 0, grid: defaultGrid(groups, area),
    placements: {}, history: [], desktopVisible: true, myGroupId: null, shortcuts: defaultShortcuts(), groupLayers: {} };
}

export function retireGroupLayout(draft, sourceId, targetId, affectedCards) {
  const affected = new Set(affectedCards);
  draft.grid.slots = draft.grid.slots.map(id => id === sourceId ? null : id);
  if (draft.myGroupId === sourceId) draft.myGroupId = targetId;
  // The receiving group keeps its own layer.
  if (draft.groupLayers) delete draft.groupLayers[sourceId];
  for (const key of Object.keys(draft.shortcuts)) if (draft.shortcuts[key] === sourceId) draft.shortcuts[key] = targetId;
  const oldLength = draft.history.length;
  draft.history = draft.history.filter(entry => !entry.transfer || !(affected.has(entry.transfer.cardId)
    || [entry.transfer.fromGroupId, entry.transfer.toGroupId].includes(sourceId)));
  return { movedCards: affected.size, retiredGroupId: sourceId, removedUndo: oldLength - draft.history.length };
}

export function recordTransferLayout(draft, cardId, position, transfer) {
  const rect = draft.placements[cardId];
  requireValue(rect || !position, 'missing-placement', '找不到卡片位置。');
  draft.history.push({ kind: 'transfer', before: rect ? { [cardId]: geometry(rect) } : {}, transfer: copy(transfer) });
  if (position) {
    requireValue(Number.isFinite(position.x) && Number.isFinite(position.y), 'invalid-position', '卡片位置無效。');
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
  requireValue(workAreas.length && workAreas.every(validRect), 'invalid-area', '沒有可用顯示器。');
  if (reachable(rect, workAreas)) return copy(rect);
  const distance = area => Math.max(area.x - rect.x, 0, rect.x - area.x - area.width) ** 2
    + Math.max(area.y - rect.y, 0, rect.y - area.y - area.height) ** 2;
  const area = [...workAreas].sort((a, b) => distance(a) - distance(b))[0];
  return { ...rect, x: Math.max(area.x, Math.min(rect.x, area.x + Math.max(0, area.width - rect.width))),
    y: Math.max(area.y, Math.min(rect.y, area.y + Math.max(0, area.height - rect.height))) };
}

/** Single writer per device; persist must atomically save the full supplied snapshot or reject. */
export class LayoutStore {
  #state;
  #persist;
  #tail = Promise.resolve();

  constructor(state, persist) {
    requireValue(typeof persist === 'function', 'missing-storage', '需要可靠的版面保存介面。');
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
    const allowed = ['grid', 'desktopVisible', 'myGroupId', 'shortcuts'];
    requireValue(Object.keys(patch).every(key => allowed.includes(key)), 'invalid-setting', '未知的版面設定。');
    if (patch.grid) gridRegions(patch.grid, activeGroups(snapshot));
    requireValue(!('desktopVisible' in patch) || typeof patch.desktopVisible === 'boolean', 'invalid-setting', '顯示設定必須是布林值。');
    requireValue(!('myGroupId' in patch) || patch.myGroupId === null || activeGroups(snapshot).some(group => group.id === patch.myGroupId),
      'invalid-group-setting', '屬於我的群組已不存在。');
    if ('shortcuts' in patch) patch.shortcuts = validateShortcuts(patch.shortcuts, activeGroups(snapshot));
    return this.#transaction(draft => { Object.assign(draft, copy(patch)); return { groups: groupKey(snapshot) }; });
  }

  async setCardPolicy(cardId, patch) {
    patch = copy(patch);
    requireValue(Object.keys(patch).every(key => key === 'visible'), 'invalid-setting', '未知的卡片顯示設定。');
    requireValue(!('visible' in patch) || typeof patch.visible === 'boolean', 'invalid-setting', '顯示設定必須是布林值。');
    return this.#transaction(draft => {
      requireValue(draft.placements[cardId], 'missing-placement', '找不到卡片位置。');
      Object.assign(draft.placements[cardId], copy(patch));
    });
  }

  /** The layer belongs to the group on this device; every paper of the group follows it. */
  async setGroupLayer(groupId, layer, snapshot) {
    requireValue(groupLayerOrder.includes(layer), 'invalid-setting', '未知的常駐層級。');
    requireValue(activeGroups(copy(snapshot)).some(group => group.id === groupId), 'missing-group', '群組已不存在。');
    return this.#transaction(draft => { draft.groupLayers = { ...draft.groupLayers, [groupId]: layer }; });
  }

  async placeNew(snapshot, workAreas, paperSize = { width: 280, height: 220 }, checkpoint = null) {
    snapshot = copy(snapshot); workAreas = copy(workAreas); paperSize = copy(paperSize);
    requireValue(paperSize.width > 0 && paperSize.height > 0, 'invalid-size', '卡片尺寸必須大於零。');
    return this.#transaction(async draft => {
      const groups = activeGroups(snapshot);
      const gridIds = draft.grid.slots.filter(Boolean);
      if (groups.length <= 9 && (groups.length !== gridIds.length || groups.some(group => !gridIds.includes(group.id)))) {
        // Region bookkeeping does not move papers already on the desktop.
        draft.grid = defaultGrid(groups, draft.grid.area);
      }
      const knownIds = new Set(groups.map(group => group.id));
      const regionGroups = groups.filter(group => gridIds.includes(group.id));
      const regions = groups.length <= 9 ? gridRegions(draft.grid, groups)
        : gridRegions(draft.grid, regionGroups);
      const deferred = [];
      let order = Math.max(0, ...Object.values(draft.placements).map(rect => rect.order)) + 1;
      const fresh = snapshot.cards.filter(card => !card.deleted && !draft.placements[card.id])
        .sort((a, b) => compareId(a.id, b.id));
      const existing = Object.values(draft.placements);
      for (const card of fresh) {
        if (checkpoint) await checkpoint();
        if (!knownIds.has(card.groupId)) { deferred.push(card.id); continue; }
        const region = regions.find(region => region.groupId === card.groupId) || draft.grid.area;
        let rect = { x: region.x + 12, y: region.y + 12, ...paperSize, order: order++, visible: true };
        for (let step = 0; step < 40; step++) {
          const trial = { ...rect, x: rect.x + step * 18, y: rect.y + step * 28 };
          if (containsRect(region, trial) && !existing.some(other =>
            trial.x < other.x + other.width && trial.x + trial.width > other.x
            && trial.y < other.y + other.height && trial.y + trial.height > other.y)) {
            rect = trial; break;
          }
        }
        draft.placements[card.id] = rescueRect(rect, workAreas);
        existing.push(draft.placements[card.id]);
      }
      return { deferred, groupOverflow: groups.length > 9, groups: groupKey(snapshot) };
    });
  }

  async move(cardId, position, expectedRevision) {
    position = copy(position);
    requireValue(Number.isFinite(position.x) && Number.isFinite(position.y), 'invalid-position', '卡片位置無效。');
    return this.#transaction(draft => {
      requireValue(expectedRevision === undefined || expectedRevision === draft.revision, 'stale-layout', '版面已變更，請重試。');
      const rect = draft.placements[cardId];
      requireValue(rect, 'missing-placement', '找不到卡片位置。');
      if (rect.x === position.x && rect.y === position.y) return;
      draft.history.push({ kind: 'move', before: { [cardId]: geometry(rect) } });
      Object.assign(rect, { x: position.x, y: position.y });
    });
  }

  async transfer(cardId, position, expectedRevision, transfer, persist) {
    position = copy(position); transfer = copy(transfer);
    return this.#transaction(draft => {
      requireValue(expectedRevision === undefined || expectedRevision === draft.revision, 'stale-layout', '版面已變更，請重試。');
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
      'stale-plan', '預覽後資料或版面已變更，請重新預覽。');
      requireValue(plan.allowResize || plan.resized.length === 0, 'resize-consent', '本次未允許改變卡片尺寸。');
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
      requireValue(entry.kind !== 'transfer' || persist, 'conditional-undo', '轉組復原需由資料來源檢查版本。');
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
   * Resets this device's desktop layout: default group regions, no placements or undo history, papers shown, every
   * group back on the desktop layer and no highlighted group. Shortcuts and the device identity stay. Callers re-place papers with placeNew afterwards; a
   * crash in between leaves papers unplaced, which the start-up placeNew already repairs.
   */
  async reset(snapshot, area) {
    snapshot = copy(snapshot); area = copy(area);
    requireValue(validRect(area), 'invalid-area', '沒有可用顯示器。');
    return this.#transaction(draft => {
      const groups = activeGroups(snapshot);
      // More than nine groups have no default grid; keep the regions and still clear every paper position.
      draft.grid = groups.length <= 9 ? defaultGrid(groups, area) : { ...draft.grid, area };
      Object.assign(draft, { placements: {}, history: [], desktopVisible: true, myGroupId: null, groupLayers: {} });
    });
  }

  async recoverDisplays(workAreas) {
    workAreas = copy(workAreas);
    return this.#transaction(draft => {
      const rescued = [];
      for (const [id, rect] of Object.entries(draft.placements)) {
        if (reachable(rect, workAreas)) continue;
        draft.placements[id] = rescueRect(rect, workAreas);
        rescued.push(id);
      }
      if (!workAreas.some(area => containsRect(area, draft.grid.area))) draft.grid.area = copy(workAreas[0]);
      return { reason: 'display-unreachable', rescued };
    });
  }
}
