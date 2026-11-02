import { copy } from '../core/contracts.js';

/** Keep this device's preferences and geometry only where the replacement contains the corresponding identity. */
export function deviceLayout(layout, data) {
  const cards = new Set(data.local.cards.map(item => item.id));
  const groups = new Set(data.local.groups.map(item => item.id));
  const known = (value, set) => Object.fromEntries(Object.entries(value ?? {}).filter(([id]) => set.has(id)));
  const result = { ...copy(layout), history: [], placements: known(layout.placements, cards),
    groupLayers: known(layout.groupLayers, groups), groupColors: known(layout.groupColors, groups), groupOpacity: known(layout.groupOpacity, groups),
    grid: { ...copy(layout.grid), slots: layout.grid.slots.map(id => groups.has(id) ? id : null) } };
  if (!groups.has(result.myGroupId)) result.myGroupId = null;
  if (!groups.has(result.mainGroupId)) delete result.mainGroupId;
  return result;
}
