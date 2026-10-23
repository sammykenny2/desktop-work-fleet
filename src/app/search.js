/** How many non-empty lines of a note's text count as its lead for search ranking. */
export const LEAD_LINES = 5;

/**
 * Where a lowercased query appears in a note: 0 in the title, or the first line when there is no title; 1 in the first
 * LEAD_LINES non-empty lines of the text; 2 anywhere else; -1 nowhere.
 */
export function searchTier(card, query) {
  const title = (card.content.title || '').toLocaleLowerCase(); const text = card.content.text.toLocaleLowerCase();
  if (!`${title}\n${text}`.includes(query)) return -1;
  const lines = text.split('\n').filter(line => line.trim());
  if ((title || lines[0] || '').includes(query)) return 0;
  return lines.slice(0, LEAD_LINES).some(line => line.includes(query)) ? 1 : 2;
}

/** The notes that match, best tier first; each tier keeps the order the notes came in. An empty query keeps them all. */
export function rankSearch(cards, query) {
  if (!query) return cards;
  const tiers = [[], [], []];
  for (const card of cards) { const tier = searchTier(card, query); if (tier >= 0) tiers[tier].push(card); }
  return tiers.flat();
}
