import { groupColors } from '../core/palette.js';

export const validColor = index => Number.isInteger(index) && index >= 0 && index < groupColors.length;

/**
 * Each group keeps its own palette colour on this device, so reordering or retiring other groups never repaints it.
 * A group without one takes the colour of its place in the workspace list when no other group holds it, otherwise
 * the first free colour; past nine groups colours repeat. Groups no longer listed drop out and free their colours.
 */
export function settleGroupColors(stored, groups) {
  const chosen = new Map(); const taken = new Set();
  for (const group of groups) {
    const index = stored?.[group.id];
    if (validColor(index) && !taken.has(index)) { chosen.set(group.id, index); taken.add(index); }
  }
  groups.forEach((group, position) => {
    if (chosen.has(group.id)) return;
    const preferred = position % groupColors.length;
    const free = taken.has(preferred) ? groupColors.findIndex((_, index) => !taken.has(index)) : preferred;
    chosen.set(group.id, free < 0 ? preferred : free); taken.add(chosen.get(group.id));
  });
  // Keys follow the group list, so settling an already settled map changes nothing, not even its JSON.
  return Object.fromEntries(groups.map(group => [group.id, chosen.get(group.id)]));
}

/** Gives a group in a settled colour map a colour; the group that held it, if any, takes the colour this one gives up. */
export function swapGroupColor(colors, groupId, index) {
  const result = { ...colors }; const holder = Object.keys(colors).find(id => colors[id] === index && id !== groupId);
  if (holder) result[holder] = colors[groupId];
  result[groupId] = index;
  return result;
}
