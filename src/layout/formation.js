import { activeGroups, containsRect, copy, FleetError, gridRegions, inScope,
  membershipKey, requireValue, stableCards, validRect, eligible } from '../core/contracts.js';
import { t } from '../i18n/index.js';

const inset = (rect, gap) => ({ x: rect.x + gap, y: rect.y + gap,
  width: rect.width - 2 * gap, height: rect.height - 2 * gap });
export const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const intersection = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) });

export function subtract(area, occupied) {
  if (!overlaps(area, occupied)) return [area];
  const hit = intersection(area, occupied);
  return [
    { x: area.x, y: area.y, width: area.width, height: hit.y - area.y },
    { x: area.x, y: hit.y + hit.height, width: area.width, height: area.y + area.height - hit.y - hit.height },
    { x: area.x, y: area.y, width: hit.x - area.x, height: area.height },
    { x: hit.x + hit.width, y: area.y, width: area.x + area.width - hit.x - hit.width, height: area.height },
  ].filter(validRect);
}

export function maximalAreas(areas) {
  return areas.filter((area, index) => !areas.some((other, otherIndex) => otherIndex !== index
    && containsRect(other, area) && (otherIndex < index || !containsRect(area, other))));
}

// Columns of stacks use measured summary bands. Shelves of spread cards use full paper heights.
function pack(cards, placements, bounds, mode, gap, bands, scale = 1) {
  const result = {};
  let x = bounds.x; let y = bounds.y; let extent = 0;
  for (const card of cards) {
    const original = placements[card.id];
    const width = original.width * scale; const height = original.height * scale;
    if (width > bounds.width || height > bounds.height) return null;
    if (mode === 'spread') {
      if (x + width > bounds.x + bounds.width + 0.001) {
        x = bounds.x; y += extent + gap; extent = 0;
      }
      if (y + height > bounds.y + bounds.height + 0.001) return null;
      result[card.id] = { ...original, x, y, width, height };
      x += width + gap; extent = Math.max(extent, height);
    } else {
      if (y + height > bounds.y + bounds.height + 0.001) {
        x += extent + gap; y = bounds.y; extent = 0;
      }
      if (x + width > bounds.x + bounds.width + 0.001) return null;
      result[card.id] = { ...original, x, y, width, height };
      y += bands[card.id]; extent = Math.max(extent, width);
    }
  }
  return result;
}

function packAcross(cards, placements, bounds, mode, gap, bands) {
  const result = {};
  let remaining = cards;
  let available = maximalAreas(bounds);
  while (available.length) {
    const area = available.shift();
    let count = 0; let fitted = {};
    // Find the largest stable prefix which fits without dropping any later card.
    for (let low = 1, high = remaining.length; low <= high;) {
      const middle = Math.floor((low + high) / 2);
      const trial = pack(remaining.slice(0, middle), placements, area, mode, gap, bands);
      if (trial) { count = middle; fitted = trial; low = middle + 1; }
      else high = middle - 1;
    }
    Object.assign(result, fitted);
    remaining = remaining.slice(count);
    if (!remaining.length) return result;
    if (count) {
      // Maximal free rectangles overlap. Reserve each placed paper before trying another region.
      available.push(area);
      for (const rect of Object.values(fitted)) available = maximalAreas(available.flatMap(free => subtract(free, rect)));
    }
  }
  return null;
}

/** Pure preview. It neither mutates layout nor resizes unless this invocation permits it. */
export function planFormation({ snapshot, layout, scope, mode, grid = layout.grid,
  workAreas, summaryBands, allowResize = false, minimumSize = { width: 160, height: 96 }, gap = 12 }) {
  requireValue(['stack', 'spread'].includes(mode), 'invalid-formation', t('errors.core.formationUnknown'));
  requireValue(scope.kind === 'all' || scope.kind === 'group', 'invalid-scope', t('errors.core.scopeRequired'));
  requireValue(Array.isArray(workAreas) && workAreas.length && workAreas.every(validRect)
    && Number.isFinite(gap) && gap >= 0, 'invalid-area', t('errors.common.workAreaRequired'));
  const groups = activeGroups(snapshot);
  const regions = gridRegions(grid, groups);
  requireValue(scope.kind === 'all' || groups.some(group => group.id === scope.groupId),
    'missing-group', t('errors.common.groupMissing'));
  const cards = stableCards(snapshot.cards.filter(card => eligible(card, layout) && inScope(card, scope)), layout);
  for (const card of cards) {
    requireValue(validRect(layout.placements[card.id]), 'missing-placement', t('errors.core.placementInvalid'), { cardId: card.id });
    requireValue(Number.isFinite(summaryBands?.[card.id]) && summaryBands[card.id] > 0
      && summaryBands[card.id] <= layout.placements[card.id].height,
    'missing-measurement', t('errors.core.measurementMissing'), { cardId: card.id });
    requireValue(groups.some(group => group.id === card.groupId), 'missing-group', t('errors.core.groupPendingSync'));
  }
  const changes = {}; const overflow = []; const resized = [];
  let available = workAreas.map(area => inset(area, gap));
  const occupied = [];
  const unobstructed = packed => packed && !Object.values(packed).some(rect => occupied.some(other => overlaps(rect, other)));
  for (const region of regions.filter(region => region.groupId)) {
    const members = cards.filter(card => card.groupId === region.groupId);
    if (!members.length) continue;
    const bounds = inset(region, gap);
    let packed = pack(members, layout.placements, bounds, mode, gap, summaryBands);
    if (!unobstructed(packed)) packed = null;
    if (!packed && allowResize) {
      const floor = Math.max(...members.map(card => {
        const rect = layout.placements[card.id];
        return Math.max(minimumSize.width / rect.width,
          Math.max(minimumSize.height, summaryBands[card.id]) / rect.height);
      }));
      // A finite, deterministic search; fonts and summary bands are never scaled down.
      for (let step = 1; step <= 40 && !packed && floor < 1; step++) {
        packed = pack(members, layout.placements, bounds, mode, gap, summaryBands,
          Math.max(floor, 1 - step * (1 - floor) / 40));
        if (!unobstructed(packed)) packed = null;
      }
    }
    if (!packed) {
      const containing = workAreas.find(area => containsRect(area, region));
      const primary = containing || workAreas[0];
      const rest = workAreas.filter(area => area !== primary);
      const anchored = { x: Math.max(primary.x, region.x) + gap, y: Math.max(primary.y, region.y) + gap,
        width: primary.x + primary.width - Math.max(primary.x, region.x) - 2 * gap,
        height: primary.y + primary.height - Math.max(primary.y, region.y) - 2 * gap };
      const anchoredFree = available.map(area => intersection(area, anchored)).filter(validRect);
      const otherFree = available.filter(area => rest.some(other => containsRect(other, area)));
      packed = packAcross(members, layout.placements, [...anchoredFree, ...otherFree], mode, gap, summaryBands)
        || packAcross(members, layout.placements, available, mode, gap, summaryBands);
    }
    if (!packed || Object.values(packed).some(rect => !workAreas.some(area => containsRect(area, rect)))) {
      throw new FleetError('capacity', t('errors.core.formationCapacity'), { groupId: region.groupId, cardIds: members.map(card => card.id) });
    }
    const orders = members.map(card => layout.placements[card.id].order).sort((a, b) => a - b);
    members.forEach((card, index) => {
      changes[card.id] = { ...packed[card.id], order: orders[index] };
      if (!containsRect(region, packed[card.id])) overflow.push(card.id);
      if (packed[card.id].width !== layout.placements[card.id].width
        || packed[card.id].height !== layout.placements[card.id].height) resized.push(card.id);
    });
    if (scope.kind === 'all') {
      // Each group reserves paper footprints; overflow must not conceal another group's summaries.
      for (const rect of Object.values(packed)) {
        occupied.push(rect);
        available = maximalAreas(available.flatMap(area => subtract(area, rect)));
      }
    }
  }
  return { kind: 'formation', layoutRevision: layout.revision, membership: membershipKey(snapshot, layout),
    scope: copy(scope), mode, grid: copy(grid), changes, overflow, resized, allowResize };
}
