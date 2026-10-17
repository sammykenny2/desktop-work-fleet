// UI text lookup. Import-safe in Node, the main window and desktop scenes: nothing here touches the DOM at load time.
import { catalogs } from './catalogs.js';

export const LOCALES = Object.freeze(['en', 'zh-TW']);
export const DEFAULT_LOCALE = 'en';
/** 'auto' follows the system languages; the others pin a locale. Stored per device, never in backups or Google. */
export const LANGUAGE_PREFERENCES = Object.freeze(['auto', ...LOCALES]);

let current = DEFAULT_LOCALE;
const listeners = new Set();

const interpolate = (text, values) => values ? text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
  values[name] === undefined || values[name] === null ? match : String(values[name])) : text;

export const hasMessage = (key, locale = current) => Object.hasOwn(catalogs[locale] ?? {}, key) || Object.hasOwn(catalogs.en, key);

/** Looks the key up in the current locale, then English. A missing key returns the key itself so the gap stays visible. */
export function t(key, values) {
  const text = catalogs[current]?.[key] ?? catalogs.en[key];
  return text === undefined ? key : interpolate(text, values);
}

/** Picks `${key}.one` or `${key}.other` by the count's plural category; `count` is also available as {count}. */
export function plural(key, count, values = {}) {
  const category = new Intl.PluralRules(current).select(count);
  const chosen = hasMessage(`${key}.${category}`) ? `${key}.${category}` : `${key}.other`;
  return t(chosen, { count, ...values });
}

/**
 * Maps one BCP 47 tag or POSIX locale name to a supported locale, or null. English variants map to en; Chinese that is
 * Traditional or unmarked (zh, zh-TW, zh-Hant, zh-HK, zh-MO) maps to zh-TW; Simplified Chinese is not supported yet.
 * Every native host repeats exactly these rules for the strings it draws itself (docs/i18n.md).
 */
export function matchLocale(tag) {
  if (typeof tag !== 'string') return null;
  const value = tag.trim().replace(/[.@].*$/, '').replace(/_/g, '-').toLowerCase();
  if (value === 'en' || value.startsWith('en-')) return 'en';
  if (['zh', 'zh-tw', 'zh-hant', 'zh-hk', 'zh-mo'].includes(value)
    || ['zh-tw-', 'zh-hant-', 'zh-hk-', 'zh-mo-'].some(prefix => value.startsWith(prefix))) return 'zh-TW';
  return null;
}

export function resolveLocale(preference, languages = []) {
  if (LOCALES.includes(preference)) return preference;
  for (const tag of languages || []) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export const validPreference = value => LANGUAGE_PREFERENCES.includes(value);
export const getLocale = () => current;

export function setLocale(locale) {
  const next = LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  if (globalThis.document?.documentElement) globalThis.document.documentElement.lang = next;
  if (next === current) return false;
  current = next;
  for (const listener of [...listeners]) listener(next);
  return true;
}

export function onLocaleChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

/** Dates and times in the current locale; callers pass Intl.DateTimeFormat options. */
export function formatDate(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(current, options).format(date);
}

/**
 * Fills static markup: data-i18n sets the text, data-i18n-attr sets attributes as "name:key;name:key".
 * Elements keep no text of their own in the HTML, so the catalogs are the only copy.
 */
export function localizeDocument(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [name, key] = pair.split(':').map(part => part.trim());
      if (name && key) node.setAttribute(name, t(key));
    }
  }
  if (root.documentElement) root.documentElement.lang = current;
}
