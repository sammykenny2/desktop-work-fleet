import { copy, requireValue } from './contracts.js';

// App versions and content/CAS revisions are deliberately independent of these format versions.
export const schemas = Object.freeze({ workspace: 2, layout: 1, revision: 1, backup: 1, encryptedBackup: 1, journal: 1, driveFile: 1 });

export function requireSchemaVersion(value, kind, { minimum = schemas[kind], field = 'schemaVersion', code = 'unsupported-schema' } = {}) {
  const current = schemas[kind]; const found = value?.[field];
  requireValue(Number.isSafeInteger(current) && Number.isSafeInteger(found) && found >= minimum && found <= current,
    code, '資料格式版本不受支援，請使用相容或較新版 App；原資料仍保留。', { kind, found, minimum, supported: current });
  return found;
}

/** Pure, sequential upgrades. The caller validates and atomically persists the final candidate before publishing it. */
export function migrateSchema(input, { kind, current = schemas[kind], minimum = 1, steps, validate = () => {} }) {
  const found = input?.schemaVersion;
  requireValue(Number.isSafeInteger(current) && Number.isSafeInteger(found) && found >= minimum && found <= current,
    'unsupported-schema', '資料格式版本不受支援，請更新 App；原資料仍保留。', { kind, found, minimum, supported: current });
  let candidate = copy(input);
  for (let version = found; version < current; version++) {
    const step = steps[version];
    requireValue(typeof step === 'function', 'missing-migration', '缺少必要的資料升級步驟；原資料仍保留。', { kind, from: version, to: version + 1 });
    const next = step(copy(candidate));
    requireValue(next && typeof next === 'object' && !Array.isArray(next) && !(next instanceof Promise)
      && next.schemaVersion === version && next.profileId === candidate.profileId && next.revision === candidate.revision,
    'invalid-migration', '資料升級步驟無效；原資料仍保留。');
    candidate = next; candidate.schemaVersion = version + 1;
    validate(candidate, version + 1);
  }
  if (found === current) validate(candidate, current);
  return { state: candidate, fromVersion: found, changed: found !== current };
}

/** Storage adapters validate the source read inside their CAS transaction, never a caller-supplied snapshot. */
export function validateMigration(before, after, fromVersion) {
  requireValue(Number.isSafeInteger(fromVersion) && fromVersion >= 1 && before?.schemaVersion === fromVersion
    && Number.isSafeInteger(after.schemaVersion) && after.schemaVersion > fromVersion
    && before.profileId === after.profileId && after.revision === before.revision + 1,
  'invalid-migration', '資料升級條件與原始資料不同；原資料仍保留。');
}
