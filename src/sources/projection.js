import { compareCards, compareId, copy, defaultGrid } from '../core/contracts.js';
import { groupResolver, resolveGroupId } from '../core/groups.js';
import { orderedGroups } from '../layout/order.js';
import { settleGroupColors } from '../layout/colors.js';

export const projectionConflictKinds = new Set(['revision', 'group-reference', 'card-group', 'group-overflow', 'pending-revisions']);

/** A visible branch is a reading preference, never a conflict resolution or a new shared revision. */
function* projectionSteps(graph, previous = { groups: [], cards: [], conflicts: [] }) {
  const groups = []; const cards = [];
  const conflicts = (previous.conflicts || []).filter(item => !projectionConflictKinds.has(item.kind)).map(copy);
  const preferences = { group: new Map(previous.groups.map(value => [value.id, value])), card: new Map(previous.cards.map(value => [value.id, value])) };
  for (const { kind, entityId, heads } of graph.iterateEntities()) {
    const old = preferences[kind].get(entityId);
    const selected = heads.find(head => head.revisionId === old?.revision)
      || [...heads].sort((a, b) => Number(a.value.deleted) - Number(b.value.deleted) || compareId(a.revisionId, b.revisionId))[0];
    (kind === 'group' ? groups : cards).push(copy(selected.value));
    if (heads.length > 1) conflicts.push({ kind: 'revision', entityKind: kind, entityId, heads: heads.map(head => head.revisionId) });
    yield;
  }
  // Groups keep this device's order and append new ones; cards read in creation order on every device.
  const positions = new Map(previous.groups.map((value, index) => [value.id, index]));
  groups.sort((a, b) => (positions.get(a.id) ?? previous.groups.length) - (positions.get(b.id) ?? previous.groups.length)
    || compareId(a.id, b.id));
  cards.sort(compareCards);
  const snapshot = { groups, cards, conflicts };
  const resolve = groupResolver(groups);
  for (const group of groups.filter(group => group.deleted)) {
    try { resolve(group.id); }
    catch (error) { conflicts.push({ kind: 'group-reference', groupId: group.id, reason: error.code }); }
    yield;
  }
  for (const card of cards) {
    try { card.groupId = resolve(card.groupId); }
    catch (error) { conflicts.push({ kind: 'card-group', cardId: card.id, groupId: card.groupId, reason: error.code }); }
    yield;
  }
  const count = groups.filter(group => !group.deleted).length;
  if (count > 9) conflicts.push({ kind: 'group-overflow', count });
  if (graph.pending.length) conflicts.push({ kind: 'pending-revisions', revisions: graph.pending, missing: graph.missing });
  return snapshot;
}

export function projectRevisions(graph, previous) {
  const steps = projectionSteps(graph, previous); let result;
  do { result = steps.next(); } while (!result.done);
  return result.value;
}

export async function projectRevisionsAsync(graph, previous, checkpoint) {
  const steps = projectionSteps(graph, previous); let result;
  do { result = steps.next(); if (!result.done) await checkpoint(); } while (!result.done);
  return result.value;
}

/** Remote content may reconcile device references, but never move or resize an existing paper. */
export function reconcileSourceLayout(layout, snapshot, arrived = {}) {
  const result = copy(layout);
  const groups = snapshot.groups.filter(group => !group.deleted);
  const active = new Set(groups.map(group => group.id));
  // Groups this device has just received for the first time take the layer chosen for them; a stored layer stays.
  for (const [id, layer] of Object.entries(arrived)) {
    if (active.has(id) && !Object.hasOwn(result.groupLayers ?? {}, id)) result.groupLayers = { ...result.groupLayers, [id]: layer };
  }
  // Every group keeps its colour; a new one takes a free colour and a retired one frees its own.
  result.groupColors = settleGroupColors(result.groupColors, groups);
  const resolve = id => {
    try { return resolveGroupId(snapshot, id); } catch { return id; }
  };
  if (result.myGroupId) result.myGroupId = resolve(result.myGroupId);
  if (result.mainGroupId) result.mainGroupId = resolve(result.mainGroupId);
  for (const [key, target] of Object.entries(result.shortcuts)) {
    if (!target.startsWith('@')) result.shortcuts[key] = resolve(target);
  }
  const slots = result.grid.slots.map(id => active.has(id) ? id : null);
  const unassigned = groups.filter(group => !slots.includes(group.id)).map(group => group.id);
  for (let index = 0; index < slots.length && unassigned.length; index++) if (!slots[index]) slots[index] = unassigned.shift();
  result.grid.slots = slots;
  if (unassigned.length && groups.length <= 9) result.grid = defaultGrid(orderedGroups(result, groups), result.grid.area);
  result.history = result.history.filter(entry => !entry.transfer
    || [entry.transfer.fromGroupId, entry.transfer.toGroupId].every(id => active.has(id)));
  if (JSON.stringify(result) !== JSON.stringify(layout)) result.revision++;
  return result;
}
