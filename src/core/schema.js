import { requireValue } from './contracts.js';
import { t } from '../i18n/index.js';

// Version formats independently when required; preserve installed data and supported backups (ADR-073).
export const schemas = Object.freeze({ workspace: 1, layout: 1, revision: 1, backup: 1, encryptedBackup: 1, journal: 1, driveFile: 1 });

export function requireSchemaVersion(value, kind, { code = 'unsupported-schema' } = {}) {
  const current = schemas[kind]; const found = value?.schemaVersion;
  requireValue(Number.isSafeInteger(current) && found === current,
    code, t('errors.core.schemaUnsupported'), { kind, found, supported: current });
  return found;
}
