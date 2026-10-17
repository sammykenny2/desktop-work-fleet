import { localizeDocument, resolveLocale, setLocale, t, validPreference } from '../i18n/index.js';

// Native hosts keep the preference beside their other device settings so the tray and menus follow it before the
// window opens. The browser preview has no host and keeps it in this origin's storage, which may be unavailable.
const STORAGE_KEY = 'work-fleet.language';
let preference = 'auto';
let system = [];
let bridge = null;

function storedPreference() {
  try { const value = globalThis.localStorage?.getItem(STORAGE_KEY); return validPreference(value) ? value : 'auto'; }
  catch { return 'auto'; }
}

function apply() {
  setLocale(resolveLocale(preference, system));
  localizeDocument();
}

function adopt(value) {
  if (!value || !validPreference(value.preference)) return false;
  preference = value.preference;
  system = Array.isArray(value.system) ? value.system.filter(tag => typeof tag === 'string') : [];
  return true;
}

/** Applies the browser's languages before anything else renders. */
export function startLanguage(view = globalThis) {
  preference = storedPreference();
  system = [...(view.navigator?.languages || [view.navigator?.language].filter(Boolean))];
  apply();
}

/** A host that reports its language owns the preference and supplies the system languages it resolves them from. */
export function adoptHostLanguage(native) {
  if (native?.info.capabilities?.languagePreference && adopt(native.info.language)) bridge = native.bridge;
  apply();
}

export const languagePreference = () => preference;

/** The option labels are names in the current UI language, as in Cats; "Auto-detect" does not name its result. */
export function languageOptions() {
  return [
    { value: 'auto', label: t('settings.general.languageAuto') },
    { value: 'en', label: t('settings.general.languageEnglish') },
    { value: 'zh-TW', label: t('settings.general.languageTraditionalChinese') },
  ];
}

export async function changeLanguage(value) {
  if (!validPreference(value)) throw new Error(`Unknown language preference: ${value}`);
  if (bridge) adopt(await bridge.request('host.language.set', { preference: value }));
  else {
    preference = value;
    try { globalThis.localStorage?.setItem(STORAGE_KEY, value); } catch { /* The choice still applies to this window. */ }
  }
  apply();
}
