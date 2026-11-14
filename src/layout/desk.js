import { copy } from '../core/contracts.js';
import { settleGroupColors } from './colors.js';
import { maxOrder, orderRange, zeroOrder } from './stacking.js';

/**
 * What one computer has one value of, whatever collections are open (ADR-066): the group regions, shortcuts, display
 * switches, the main view and group, and the group colours. `known` remembers which profile owns each group this desk has
 * seen, so that a group the user took off the desktop stays off and a signed-out account's regions stay reserved.
 */
export const deskKey = 'desk';
export const deskFields = Object.freeze(['desktopVisible', 'completedVisible', 'quickMove', 'newPaperSize', 'mainView', 'mainGroupId', 'shortcuts']);

/** The first start takes what the primary profile's layout already holds, so existing settings carry over. */
export function seedDesk(layout) {
  const desk = { revision: 0, grid: copy(layout.grid), groupColors: copy(layout.groupColors ?? {}), known: {} };
  for (const key of deskFields) if (layout[key] !== undefined) desk[key] = copy(layout[key]);
  return desk;
}

// A region stays reserved for a collection that is not open, so that signing in restores the desktop. Another account being
// open frees it: only one account opens at a time, and its regions would otherwise never come back.
export function isReserved(desk, id, openProfiles) {
  const owner = desk.known[id];
  return owner !== undefined && !openProfiles.includes(owner) && !(owner.startsWith('google:') && openProfiles.some(profile => profile.startsWith('google:')));
}
/** Colours of a collection that is not open are kept, so its groups wear them again when it returns. */
export function settledColors(desk, groups, openProfiles) {
  const active = new Set(groups.map(group => group.id));
  const absent = Object.keys(desk.known).filter(id => !active.has(id) && isReserved(desk, id, openProfiles)).map(id => ({ id }));
  return settleGroupColors(desk.groupColors, [...absent, ...groups]);
}

const freeSlot = slots => slots.indexOf(null);

/** A new group can fill an empty region; only the user changes the grid's dimensions. */
function placeInGrid(grid, groupId) {
  const free = freeSlot(grid.slots);
  if (free >= 0) { grid.slots[free] = groupId; return true; }
  return false;
}

/**
 * Brings the desk up to date with the open collections. A group that is gone gives its region to the group it was merged
 * into, if any; a region of a profile that is not open stays reserved; a group never seen takes a free region.
 * `groups` lists `{ id, profileId }` in list order and `resolve(id, ownerId)` follows a merge inside its own collection.
 */
export function settleDesk(desk, groups, openProfiles, resolve) {
  const result = copy(desk); const active = new Set(groups.map(group => group.id));
  const reserved = id => isReserved(result, id, openProfiles);
  const held = new Set(result.grid.slots.filter(id => id && active.has(id)));
  result.grid.slots = result.grid.slots.map(id => {
    if (!id || active.has(id) || reserved(id)) return id;
    const target = resolve(id, result.known[id]);
    if (target && active.has(target) && !held.has(target)) { held.add(target); return target; }
    return null;
  });
  if (result.mainGroupId && !active.has(result.mainGroupId) && !reserved(result.mainGroupId)) {
    const target = resolve(result.mainGroupId, result.known[result.mainGroupId]);
    if (target && active.has(target)) result.mainGroupId = target; else delete result.mainGroupId;
  }
  for (const group of groups) {
    if (result.known[group.id] === group.profileId) continue;
    result.known[group.id] = group.profileId;
    if (!result.grid.slots.includes(group.id)) placeInGrid(result.grid, group.id);
  }
  for (const id of Object.keys(result.known)) if (!active.has(id) && !reserved(id) && !result.grid.slots.includes(id)) delete result.known[id];
  result.groupColors = settledColors(result, groups, openProfiles);
  return result;
}

/** Off the desktop: every open group that holds no region. */
export function hiddenGroups(desk, groups) {
  const held = new Set(desk.grid.slots.filter(Boolean));
  return Object.fromEntries(groups.filter(group => !held.has(group.id)).map(group => [group.id, true]));
}

/** Single writer per device, in the same way as a profile's layout; `persist` saves the whole record or rejects. */
export class DeskStore {
  #state; #persist; #tail = Promise.resolve(); #reserved = zeroOrder;
  constructor(state, persist) { this.#state = copy(state); this.#persist = persist; }
  get state() { return copy(this.#state); }
  whenIdle() { return this.#tail; }
  /** Counter receipts do not change visual layout revision or make a drag/formation stale. */
  reserveOrders(count, floor = zeroOrder) {
    const operation = this.#tail.then(async () => {
      const labels = orderRange(maxOrder(this.#state.zOrderCounter, this.#reserved, floor), count);
      if (!labels.length) return labels;
      // An uncertain write may have persisted: skip its range even before read-back/restart.
      this.#reserved = labels.at(-1);
      const next = { ...copy(this.#state), zOrderCounter: this.#reserved };
      await this.#persist(copy(next), { reservation: true }); this.#state = next;
      return labels;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
  update(change) {
    const operation = this.#tail.then(async () => {
      const draft = copy(this.#state); const result = await change(draft);
      const next = result?.desk ?? draft;
      if (JSON.stringify(next) === JSON.stringify(this.#state)) return result?.value ?? result;
      next.revision = this.#state.revision + 1; next.changedAt = Date.now();
      await this.#persist(copy(next)); this.#state = next;
      return result?.value ?? result;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
