import { compareId, requireValue } from '../core/contracts.js';
import { t } from '../i18n/index.js';

export const zeroOrder = '00000000000000000000000000000000';
export const lastOrder = 'ffffffffffffffffffffffffffffffff';
export const validZOrder = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
export function checkZOrder(value) {
  requireValue(validZOrder(value), 'invalid-stacking', t('errors.core.stackingInvalid'));
  return value;
}
export const maxOrder = (...values) => values.reduce((max, value) => value === undefined ? max
  : compareId(checkZOrder(value), max) > 0 ? value : max, zeroOrder);

/** Labels stay strings across JSON/native boundaries; never round through Number. */
export function orderRange(after, count) {
  checkZOrder(after);
  requireValue(Number.isSafeInteger(count) && count >= 0, 'invalid-stacking', t('errors.core.stackingInvalid'));
  const end = BigInt(`0x${after}`) + BigInt(count);
  requireValue(end <= BigInt(`0x${lastOrder}`), 'stacking-exhausted', t('errors.core.stackingExhausted'));
  return Array.from({ length: count }, (_, index) => (end - BigInt(count - index - 1)).toString(16).padStart(32, '0'));
}

export function layoutHighWater(layout) {
  let high = maxOrder(layout.zOrderCounter);
  for (const rect of Object.values(layout.placements)) high = maxOrder(high, rect.zOrder);
  for (const entry of layout.history ?? []) {
    for (const rect of Object.values(entry.before ?? {})) high = maxOrder(high, rect.zOrder);
    for (const value of Object.values(entry.afterZ ?? {})) if (value !== null) high = maxOrder(high, value);
  }
  return high;
}

/** Back-to-front order; old installations need no eager rewrite. */
export function visualOrder(cards, layout) {
  return [...cards].sort((a, b) => {
    const left = layout.placements[a.id], right = layout.placements[b.id];
    if (left?.zOrder !== undefined) checkZOrder(left.zOrder);
    if (right?.zOrder !== undefined) checkZOrder(right.zOrder);
    return compareId(left?.zOrder ?? '', right?.zOrder ?? '')
      || (left?.order ?? 0) - (right?.order ?? 0)
      || compareId(layout.owners?.[a.id] ?? '', layout.owners?.[b.id] ?? '') || compareId(a.id, b.id);
  });
}

export const isFront = (order, ids) => ids.length === 0 || ids.length <= order.length
  && ids.every((id, index) => order[order.length - ids.length + index] === id);

/** Snapshot only paper geometry and its optional visual label, preserving old absent-label snapshots. */
export const paperGeometry = rect => Object.fromEntries(['x', 'y', 'width', 'height', 'order', 'zOrder']
  .filter(key => rect[key] !== undefined).map(key => [key, rect[key]]));

export function restorePaper(rect, previous, after) {
  const { zOrder, ...geometry } = previous;
  const restore = after !== undefined && (rect.zOrder ?? null) === after;
  Object.assign(rect, geometry);
  if (restore) { if (zOrder === undefined) delete rect.zOrder; else rect.zOrder = zOrder; }
}
