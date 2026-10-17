import { compareId, copy, requireValue, summaryText } from './contracts.js';
import { t } from '../i18n/index.js';

/** A retired group retains its explicit destination; missing dependencies and cycles are never guessed. */
export function resolveGroupId(state, groupId) {
  const seen = new Set();
  while (true) {
    requireValue(!seen.has(groupId), 'group-cycle', t('errors.core.groupCycle'));
    seen.add(groupId);
    const group = state.groups.find(item => item.id === groupId);
    requireValue(group, 'missing-group', t('errors.common.groupMissingOrPending'));
    if (!group.deleted) return group.id;
    requireValue(group.redirectGroupId, 'missing-group', t('errors.core.groupDeletedNoRecipient'));
    groupId = group.redirectGroupId;
  }
}

/** One immutable projection can resolve long shared redirect chains in linear time. */
export function groupResolver(groups) {
  const byId = new Map(groups.map(group => [group.id, group])); const results = new Map();
  return initial => {
    const seen = new Set(); let id = initial; let result;
    try {
      while (!results.has(id)) {
        requireValue(!seen.has(id), 'group-cycle', t('errors.core.groupCycle')); seen.add(id);
        const group = byId.get(id); requireValue(group, 'missing-group', t('errors.common.groupMissingOrPending'));
        if (!group.deleted) { result = { id }; break; }
        requireValue(group.redirectGroupId, 'missing-group', t('errors.core.groupDeletedNoRecipient')); id = group.redirectGroupId;
      }
      result ||= results.get(id);
    } catch (error) { result = { error }; }
    for (const visited of seen) results.set(visited, result);
    if (result.error) throw result.error; return result.id;
  };
}

export function planGroupMerge(state, sourceId, targetId) {
  requireValue(sourceId !== targetId, 'same-group', t('errors.core.mergeSameGroup'));
  const source = state.groups.find(group => group.id === sourceId && !group.deleted);
  const target = state.groups.find(group => group.id === targetId && !group.deleted);
  requireValue(source && target, 'missing-group', t('errors.core.mergeGroupsMissing'));
  const cards = state.cards.filter(card => card.groupId === sourceId).sort((a, b) => compareId(a.id, b.id));
  const cardIds = new Set(cards.map(card => card.id));
  const drafts = Object.values(state.drafts || {}).filter(draft => draft.groupId === sourceId || cardIds.has(draft.cardId))
    .sort((a, b) => compareId(a.id, b.id));
  return {
    kind: 'group-merge', sourceId, targetId, sourceName: source.name, targetName: target.name,
    fingerprint: JSON.stringify([source.revision, target.revision, cards.map(card => [card.id, card.revision]), drafts]),
    cards: cards.map(card => ({ id: card.id, summary: summaryText(card), deleted: card.deleted,
      archived: card.archived, completed: card.completed })),
    draftCount: drafts.length,
  };
}

export function validateGroupMerge(state, plan) {
  const current = planGroupMerge(state, plan.sourceId, plan.targetId);
  requireValue(plan.kind === 'group-merge' && plan.fingerprint === current.fingerprint,
    'stale-group-plan', t('errors.core.mergePlanStale'));
  return copy(current);
}
