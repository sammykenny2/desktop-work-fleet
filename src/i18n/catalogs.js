// Every locale has the same area files. An area file's keys all start with its file name and a dot, so areas never
// collide; tests/i18n.test.js checks that and that every locale has the same keys and placeholders.
import enCommon from './locales/en/common.js';
import enApp from './locales/en/app.js';
import enSettings from './locales/en/settings.js';
import enSync from './locales/en/sync.js';
import enBackup from './locales/en/backup.js';
import enConflicts from './locales/en/conflicts.js';
import enNotes from './locales/en/notes.js';
import enDesktop from './locales/en/desktop.js';
import enErrorsCommon from './locales/en/errors.common.js';
import enErrorsCore from './locales/en/errors.core.js';
import enErrorsSources from './locales/en/errors.sources.js';
import enErrorsBackup from './locales/en/errors.backup.js';
import enErrorsStorage from './locales/en/errors.storage.js';
import enErrorsDesktop from './locales/en/errors.desktop.js';
import enNativeErrors from './locales/en/nativeErrors.js';
import zhCommon from './locales/zh-TW/common.js';
import zhApp from './locales/zh-TW/app.js';
import zhSettings from './locales/zh-TW/settings.js';
import zhSync from './locales/zh-TW/sync.js';
import zhBackup from './locales/zh-TW/backup.js';
import zhConflicts from './locales/zh-TW/conflicts.js';
import zhNotes from './locales/zh-TW/notes.js';
import zhDesktop from './locales/zh-TW/desktop.js';
import zhErrorsCommon from './locales/zh-TW/errors.common.js';
import zhErrorsCore from './locales/zh-TW/errors.core.js';
import zhErrorsSources from './locales/zh-TW/errors.sources.js';
import zhErrorsBackup from './locales/zh-TW/errors.backup.js';
import zhErrorsStorage from './locales/zh-TW/errors.storage.js';
import zhErrorsDesktop from './locales/zh-TW/errors.desktop.js';
import zhNativeErrors from './locales/zh-TW/nativeErrors.js';

export const areas = {
  en: { common: enCommon, app: enApp, settings: enSettings, sync: enSync, backup: enBackup, conflicts: enConflicts,
    notes: enNotes, desktop: enDesktop, 'errors.common': enErrorsCommon, 'errors.core': enErrorsCore,
    'errors.sources': enErrorsSources, 'errors.backup': enErrorsBackup, 'errors.storage': enErrorsStorage,
    'errors.desktop': enErrorsDesktop, nativeErrors: enNativeErrors },
  'zh-TW': { common: zhCommon, app: zhApp, settings: zhSettings, sync: zhSync, backup: zhBackup, conflicts: zhConflicts,
    notes: zhNotes, desktop: zhDesktop, 'errors.common': zhErrorsCommon, 'errors.core': zhErrorsCore,
    'errors.sources': zhErrorsSources, 'errors.backup': zhErrorsBackup, 'errors.storage': zhErrorsStorage,
    'errors.desktop': zhErrorsDesktop, nativeErrors: zhNativeErrors },
};

export const catalogs = Object.fromEntries(Object.entries(areas).map(([locale, files]) =>
  [locale, Object.freeze(Object.assign({}, ...Object.values(files)))]));
