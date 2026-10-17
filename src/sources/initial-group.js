import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { sha256, validFileId } from './files.js';
import { revisionRecord } from './revisions.js';
import { t } from '../i18n/index.js';

// Persisted V1 protocol value, kept in Chinese on purpose: every device derives byte-identical initial records and
// compares their hashes (ADR-053, ADR-054), so this name never follows the UI language. src/core/group-name.js shows
// it in the UI language instead.
export const INITIAL_GROUP_NAME = '我的便箋';

export const resetFileIds = files => Object.values(files || {}).filter(file => file.kind === 'reset').map(file => file.id).sort();

/** The complete automatic root is deterministic; user-created groups and later revisions stay ordinary records. */
export async function initialGroupRecord(sourceId, resetIds) {
  requireValue(Array.isArray(resetIds) && resetIds.every(validFileId) && new Set(resetIds).size === resetIds.length,
    'invalid-initial-group', t('errors.sources.initialGroupResetIds'));
  resetIds = [...resetIds].sort();
  const digest = await sha256(new TextEncoder().encode(canonicalJson(['work-fleet-initial-group', sourceId, resetIds])));
  return revisionRecord('group', { id: `initial-group:${digest}`, revision: `initial-group-root:${digest}`,
    name: INITIAL_GROUP_NAME, deleted: false });
}
