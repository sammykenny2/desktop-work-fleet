// How see-through a group's papers are while they rest on the Top layer, kept per device next to its colour
// (layout.groupOpacity, SPEC-003 2026-10-23 addendum). A group without an entry is opaque.
export const MIN_OPACITY = 0.3;
export const validOpacity = value => typeof value === 'number' && Number.isFinite(value) && value >= MIN_OPACITY && value <= 1;
export const groupOpacity = (layout, groupId) => validOpacity(layout.groupOpacity?.[groupId]) ? layout.groupOpacity[groupId] : 1;

/** A palette colour (#rrggbb) at an opacity, as the paper's background; text and thumbnails on it stay solid. */
export function translucent(color, opacity) {
  if (opacity >= 1) return color;
  const [r, g, b] = [1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
