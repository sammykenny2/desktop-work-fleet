import { requireValue } from './contracts.js';

// Pre-store development changes the current V1 directly. Revisit version upgrades before the first store launch.
export const schemas = Object.freeze({ workspace: 1, layout: 1, revision: 1, backup: 1, encryptedBackup: 1, journal: 1, driveFile: 1 });

export function requireSchemaVersion(value, kind, { code = 'unsupported-schema' } = {}) {
  const current = schemas[kind]; const found = value?.schemaVersion;
  requireValue(Number.isSafeInteger(current) && found === current,
    code, '資料格式版本不受支援；原資料仍保留。', { kind, found, supported: current });
  return found;
}
