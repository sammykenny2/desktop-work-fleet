import { requireValue } from '../core/contracts.js';
import { t } from '../i18n/index.js';

/**
 * On each device a collection's group list follows its `grid.slots`, which hold only that order (ADR-066), then any group
 * they do not hold (more than nine after a sync) in workspace order.
 */
export function orderedGroups(layout, groups) {
  const rank = new Map(layout.grid.slots.filter(Boolean).map((id, index) => [id, index]));
  return [...groups].sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
}

/** A profile's slots store sidebar order only; their capacity is independent of the desk's chosen region count. */
export function groupOrderGrid(layout, groups) {
  const ordered = orderedGroups(layout, groups);
  const rows = groups.length <= 4 ? 1 : groups.length <= 8 ? 2 : 3;
  const columns = Math.max(1, Math.ceil(groups.length / rows));
  return { rows, columns, area: layout.grid.area,
    slots: Array.from({ length: rows * columns }, (_, index) => ordered[index]?.id ?? null) };
}

/** Moves groups between the regions they hold so region order becomes `ids`; empty regions stay where they are. */
export function reorderSlots(grid, ids) {
  const held = grid.slots.filter(Boolean);
  requireValue(ids.length === held.length && new Set(ids).size === ids.length && ids.every(id => held.includes(id)),
    'invalid-slots', t('errors.core.slotsInvalid'));
  const queue = [...ids];
  return { ...grid, slots: grid.slots.map(id => id ? queue.shift() : null) };
}
