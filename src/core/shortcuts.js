import { requireValue, safeKey } from './contracts.js';
import { t } from '../i18n/index.js';

export const shortcutActions = Object.freeze({ all: '@all', capture: '@capture', toggle: '@toggle' });
// Digit keys follow the desktop grid: region N is the Nth region, left to right and top to bottom.
export const regionTarget = number => `@region${number}`;
const regionTargets = Array.from({ length: 9 }, (_, index) => regionTarget(index + 1));
export function shortcutRegion(target) {
  const match = /^@region([1-9])$/.exec(target); return match ? Number(match[1]) : null;
}
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const aliases = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta' };

export function normalizeShortcut(value) {
  requireValue(typeof value === 'string', 'invalid-shortcut', t('errors.core.shortcutNotText'));
  const parts = value.trim().split('+').map(part => part.trim());
  const key = parts.pop().toUpperCase(); const mods = parts.map(part => Object.hasOwn(aliases, part.toLowerCase()) ? aliases[part.toLowerCase()] : null);
  requireValue(/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)
    && mods.length > 0 && mods.every(Boolean) && new Set(mods).size === mods.length
    && mods.some(mod => mod !== 'Shift'), 'invalid-shortcut', t('errors.core.shortcutKeysInvalid'));
  return [...modifiers.filter(mod => mods.includes(mod)), key].join('+');
}

export function validateShortcuts(value, groups) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'invalid-shortcut', t('errors.core.shortcutSettingsInvalid'));
  // Group ids remain valid targets so layouts and backups from before region keys still load.
  const targets = new Set([...groups.map(group => group.id), ...Object.values(shortcutActions), ...regionTargets]);
  const result = {};
  for (const [key, target] of Object.entries(value)) {
    const normalized = normalizeShortcut(key);
    requireValue(safeKey(target) && targets.has(target), 'invalid-shortcut-target', t('errors.core.shortcutTargetMissing'));
    requireValue(!Object.hasOwn(result, normalized), 'duplicate-shortcut', t('errors.common.shortcutDuplicate'));
    result[normalized] = target;
  }
  return result;
}

export function defaultShortcuts() {
  return Object.fromEntries([...regionTargets.map((target, index) => [`Ctrl+Shift+${index + 1}`, target]),
    ['Ctrl+Shift+0', shortcutActions.all], ['Ctrl+Shift+N', shortcutActions.capture], ['Ctrl+Shift+D', shortcutActions.toggle]]);
}

/**
 * Layouts from before region keys bound keys to groups. Each such key moves to the region holding its group, and
 * regions left without a key get their default digit. Layouts without group bindings come back unchanged.
 */
export function regionShortcuts(shortcuts, slots) {
  if (Object.values(shortcuts).every(target => target.startsWith('@'))) return { ...shortcuts };
  const result = {};
  for (const [key, target] of Object.entries(shortcuts)) {
    if (target.startsWith('@')) result[key] = target;
    else if (slots.indexOf(target) >= 0) result[key] = regionTarget(slots.indexOf(target) + 1);
  }
  for (const [key, target] of Object.entries(defaultShortcuts())) {
    if (shortcutRegion(target) !== null && !Object.hasOwn(result, key) && !Object.values(result).includes(target)) result[key] = target;
  }
  return result;
}

/**
 * After the regions are reordered, the keys whose region now holds a different group, one entry per region in region
 * order. Regions without a key, emptied regions and regions keeping their group are left out.
 */
export function regionKeyChanges(shortcuts, before, after) {
  const bound = regionShortcuts(shortcuts, before); const changes = [];
  after.forEach((groupId, index) => {
    const keys = Object.keys(bound).filter(key => shortcutRegion(bound[key]) === index + 1);
    if (groupId && groupId !== before[index] && keys.length) changes.push({ keys, groupId });
  });
  return changes;
}

/** Region keys act on the group now in that region; keys for empty regions are dropped and stay free for other apps. */
export function resolveShortcuts(shortcuts, slots) {
  const result = {};
  for (const [key, target] of Object.entries(shortcuts)) {
    const region = shortcutRegion(target);
    if (region === null) result[key] = target;
    else if (slots[region - 1]) result[key] = slots[region - 1];
  }
  return result;
}

export function eventShortcut(event) {
  if (event.isComposing || event.repeat) return null;
  const key = /^(?:Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, '') : event.key?.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key || '')) return null;
  const mods = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta'].filter(Boolean);
  return [...mods, key].join('+');
}

export function isEditingShortcut(event) {
  return Boolean((event.ctrlKey || event.metaKey) && !event.altKey
    && ['KeyA', 'KeyC', 'KeyX', 'KeyV', 'KeyZ', 'KeyY'].includes(event.code));
}

/** Focused documents handle local bindings while the host has released OS registrations. */
export function shortcutForEvent(event, bindings, { composing = false, modal = false, editing = false, inline = false } = {}) {
  if (composing || modal || event.defaultPrevented || event.isComposing || event.repeat || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return null;
  if (editing && isEditingShortcut(event)) return null;
  const key = eventShortcut(event); const target = key && Object.hasOwn(bindings, key) ? bindings[key] : null;
  const scope = target === shortcutActions.all || target && !Object.values(shortcutActions).includes(target);
  return target && (!editing || inline && scope) ? { key, target } : null;
}
