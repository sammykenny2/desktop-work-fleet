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

/** Moves groups between the regions they hold so region order becomes `ids`; empty regions stay where they are. */
export function reorderSlots(grid, ids) {
  const held = grid.slots.filter(Boolean);
  requireValue(ids.length === held.length && new Set(ids).size === ids.length && ids.every(id => held.includes(id)),
    'invalid-slots', t('errors.core.slotsInvalid'));
  const queue = [...ids];
  return { ...grid, slots: grid.slots.map(id => id ? queue.shift() : null) };
}
