import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { sha256, validFileId } from './files.js';
import { revisionRecord } from './revisions.js';

export const resetFileIds = files => Object.values(files || {}).filter(file => file.kind === 'reset').map(file => file.id).sort();

/** The complete automatic root is deterministic; user-created groups and later revisions stay ordinary records. */
export async function initialGroupRecord(sourceId, resetIds) {
  requireValue(Array.isArray(resetIds) && resetIds.every(validFileId) && new Set(resetIds).size === resetIds.length,
    'invalid-initial-group', '初始群組的重設身分無效。');
  resetIds = [...resetIds].sort();
  const digest = await sha256(new TextEncoder().encode(canonicalJson(['work-fleet-initial-group', sourceId, resetIds])));
  return revisionRecord('group', { id: `initial-group:${digest}`, revision: `initial-group-root:${digest}`,
    name: '我的便箋', deleted: false });
}
