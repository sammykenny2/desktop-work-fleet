/**
 * Trash lists its notes by group (SPEC-012): sections follow the order of the groups given, and a group no longer listed
 * comes last. A search keeps its ranking inside each section; otherwise the most recently trashed note comes first.
 */
export function trashSections(cards, groupIds, { ranked = false } = {}) {
  const sections = new Map(groupIds.map(id => [id, []]));
  for (const card of cards) {
    if (!sections.has(card.groupId)) sections.set(card.groupId, []);
    sections.get(card.groupId).push(card);
  }
  return [...sections].filter(([, own]) => own.length).map(([groupId, own]) => ({ groupId,
    cards: ranked ? own : [...own].sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '')) }));
}
