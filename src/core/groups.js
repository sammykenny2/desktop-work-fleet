import { compareId, copy, requireValue, summaryText } from './contracts.js';

/** A retired group retains its explicit destination; missing dependencies and cycles are never guessed. */
export function resolveGroupId(state, groupId) {
  const seen = new Set();
  while (true) {
    requireValue(!seen.has(groupId), 'group-cycle', '群組合併產生循環，請先處理群組衝突。');
    seen.add(groupId);
    const group = state.groups.find(item => item.id === groupId);
    requireValue(group, 'missing-group', '群組不存在或尚待同步。');
    if (!group.deleted) return group.id;
    requireValue(group.redirectGroupId, 'missing-group', '群組已刪除且沒有接收群組。');
    groupId = group.redirectGroupId;
  }
}

export function planGroupMerge(state, sourceId, targetId) {
  requireValue(sourceId !== targetId, 'same-group', '請選擇另一個接收群組。');
  const source = state.groups.find(group => group.id === sourceId && !group.deleted);
  const target = state.groups.find(group => group.id === targetId && !group.deleted);
  requireValue(source && target, 'missing-group', '請選擇仍存在的來源與接收群組。');
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
    'stale-group-plan', '預覽後群組、便箋或草稿已變更，請重新預覽再合併。');
  return copy(current);
}
