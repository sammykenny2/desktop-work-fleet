import { requireValue } from '../core/contracts.js';
import { t } from '../i18n/index.js';

/**
 * On each device the group list follows the desktop regions: groups in region order, left to right and top to bottom,
 * then any group no region holds (more than nine after a sync) in workspace order.
 */
export function orderedGroups(layout, groups) {
  const rank = new Map(layout.grid.slots.filter(Boolean).map((id, index) => [id, index]));
  return [...groups].sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
}

/** Moves groups between the regions they hold so region order becomes `ids`; empty regions stay where they are. */
export function reorderSlots(grid, ids) {
  const held = grid.slots.filter(Boolean);
  requireValue(ids.length === held.length && new Set(ids).size === ids.length && ids.every(id => held.includes(id)),
    'invalid-slots', t('errors.core.slotsInvalid'));
  const queue = [...ids];
  return { ...grid, slots: grid.slots.map(id => id ? queue.shift() : null) };
}
