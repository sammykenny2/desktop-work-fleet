import { copy, defaultGrid } from '../core/contracts.js';
import { settleGroupColors } from './colors.js';

/**
 * What one computer has one value of, whatever collections are open (ADR-066): the group regions, shortcuts, display
 * switches, the main view and group, and the group colours. `known` remembers which profile owns each group this desk has
 * seen, so that a group the user took off the desktop stays off and a signed-out account's regions stay reserved.
 */
export const deskKey = 'desk';
export const deskFields = Object.freeze(['desktopVisible', 'completedVisible', 'quickMove', 'mainView', 'mainGroupId', 'shortcuts']);

/** The first start takes what the primary profile's layout already holds, so existing settings carry over. */
export function seedDesk(layout) {
  const desk = { revision: 0, grid: copy(layout.grid), groupColors: copy(layout.groupColors ?? {}), known: {} };
  for (const key of deskFields) if (layout[key] !== undefined) desk[key] = copy(layout[key]);
  return desk;
}

const freeSlot = slots => slots.indexOf(null);

/** Regions grow for a new group until the grid is full, as they always have; past nine the group stays off the desktop. */
function placeInGrid(grid, groupId) {
  const free = freeSlot(grid.slots);
  if (free >= 0) { grid.slots[free] = groupId; return true; }
  const held = grid.slots.length;
  if (held >= 9) return false;
  const larger = defaultGrid(Array.from({ length: held + 1 }, (_, index) => ({ id: grid.slots[index] ?? groupId })), grid.area);
  Object.assign(grid, larger); return true;
}

/**
 * Brings the desk up to date with the open collections. A group that is gone gives its region to the group it was merged
 * into, if any; a region of a profile that is not open stays reserved; a group never seen takes a free region.
 * `groups` lists `{ id, profileId }` in list order and `resolve(id, ownerId)` follows a merge inside its own collection.
 */
export function settleDesk(desk, groups, openProfiles, resolve) {
  const result = copy(desk); const active = new Set(groups.map(group => group.id));
  const reserved = id => result.known[id] !== undefined && !openProfiles.includes(result.known[id]);
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
  // Colours of a collection that is not open are kept, so its groups wear them again when it returns.
  const absent = Object.keys(result.known).filter(id => !active.has(id)).map(id => ({ id }));
  result.groupColors = settleGroupColors(result.groupColors, [...absent, ...groups]);
  return result;
}

/** Off the desktop: every open group that holds no region. */
export function hiddenGroups(desk, groups) {
  const held = new Set(desk.grid.slots.filter(Boolean));
  return Object.fromEntries(groups.filter(group => !held.has(group.id)).map(group => [group.id, true]));
}

/** Single writer per device, in the same way as a profile's layout; `persist` saves the whole record or rejects. */
export class DeskStore {
  #state; #persist; #tail = Promise.resolve();
  constructor(state, persist) { this.#state = copy(state); this.#persist = persist; }
  get state() { return copy(this.#state); }
  whenIdle() { return this.#tail; }
  update(change) {
    const operation = this.#tail.then(async () => {
      const draft = copy(this.#state); const result = await change(draft);
      const next = result?.desk ?? draft;
      if (JSON.stringify(next) === JSON.stringify(this.#state)) return result?.value ?? result;
      next.revision = this.#state.revision + 1;
      await this.#persist(copy(next)); this.#state = next;
      return result?.value ?? result;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }
}
