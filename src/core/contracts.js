// Shared semantics have no dependency on a window system or storage provider.
export class FleetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FleetError';
    this.code = code;
    this.details = details;
  }
}

export function requireValue(condition, code, message, details) {
  if (!condition) throw new FleetError(code, message, details);
}

export const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const copy = value => structuredClone(value);
export const activeGroups = snapshot => snapshot.groups.filter(group => !group.deleted);
export const groupKey = snapshot => JSON.stringify(activeGroups(snapshot).map(group => group.id).sort(compareId));
export const safeKey = key => typeof key === 'string' && key.length > 0
  && !['__proto__', 'prototype', 'constructor'].includes(key);

export function validateGrid(rows, columns, groupCount) {
  requireValue(Number.isInteger(rows) && Number.isInteger(columns)
    && rows >= 1 && rows <= 3 && columns >= 1 && columns <= 4
    && rows * columns <= 9 && groupCount <= rows * columns,
  'invalid-grid', '格局最多 3 列、4 欄、9 區，且必須容納所有群組。');
}

export function validateNewGroup(snapshot) {
  requireValue(activeGroups(snapshot).length < 9, 'group-limit', '最多可建立九個群組。請先整理現有群組。');
}

export function validRect(rect) {
  return rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
    && rect.width > 0 && rect.height > 0;
}

export const containsPoint = (rect, point) => point.x >= rect.x && point.y >= rect.y
  && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
export const containsRect = (outer, inner) => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width + 0.001
  && inner.y + inner.height <= outer.y + outer.height + 0.001;

export function eligible(card, layout) {
  return !card.deleted && !card.archived && layout.placements[card.id]?.visible !== false;
}

export function inScope(card, scope) {
  return scope.kind === 'all' || (scope.kind === 'group' && scope.groupId === card.groupId);
}

export function stableCards(cards, layout) {
  return [...cards].sort((a, b) => (layout.placements[a.id]?.order ?? 0)
    - (layout.placements[b.id]?.order ?? 0) || compareId(a.id, b.id));
}

export function membershipKey(snapshot, layout) {
  return JSON.stringify({
    groups: activeGroups(snapshot).map(group => group.id).sort(compareId),
    cards: snapshot.cards.filter(card => eligible(card, layout))
      .map(card => [card.id, card.groupId]).sort((a, b) => compareId(a[0], b[0])),
  });
}

export function summaryText(card) {
  const text = card.content?.title || card.content?.text || '';
  const line = text.split(/\r?\n/).map(part => part.trim()).find(Boolean) || '';
  return line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, '')
    .replace(/\s+/g, ' ').trim() || '新的想法';
}

export function gridRegions(grid, groups) {
  validateGrid(grid.rows, grid.columns, groups.length);
  requireValue(validRect(grid.area), 'invalid-area', '需要有效的顯示器工作區。');
  const ids = new Set(groups.map(group => group.id));
  requireValue(grid.slots.filter(Boolean).length === groups.length
    && new Set(grid.slots.filter(Boolean)).size === groups.length
    && grid.slots.filter(Boolean).every(id => ids.has(id))
    && grid.slots.length === grid.rows * grid.columns,
  'invalid-slots', '每個群組必須有一個獨立區域；空區不會建立群組。');
  const { x, y, width, height } = grid.area;
  return grid.slots.map((groupId, index) => ({
    groupId, x: x + (index % grid.columns) * width / grid.columns,
    y: y + Math.floor(index / grid.columns) * height / grid.rows,
    width: width / grid.columns, height: height / grid.rows,
  }));
}

export function defaultGrid(groups, area) {
  requireValue(groups.length <= 9, 'group-overflow', '同步帶來超過九組；資料保留，請先整理群組。');
  const rows = groups.length <= 4 ? 1 : groups.length <= 8 ? 2 : 3;
  const columns = Math.max(1, Math.ceil(groups.length / rows));
  return { rows, columns, area: copy(area),
    slots: Array.from({ length: rows * columns }, (_, index) => groups[index]?.id ?? null) };
}
