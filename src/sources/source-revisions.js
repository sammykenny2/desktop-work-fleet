import { requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { validateRevision } from './revisions.js';
import { validFileId } from './files.js';
import { resetFileIds } from './initial-group.js';

function resetIds(value) {
  requireValue(Array.isArray(value) && value.every(validFileId) && new Set(value).size === value.length,
    'invalid-source-generation', '同步版本的重設身分無效。');
  return [...value].sort();
}

/** Source scope belongs to the transport bytes, never to the immutable portable revision or its identity. */
export function encodeSourceRevision(record, resets) {
  return new TextEncoder().encode(canonicalJson({ ...validateRevision(record), sourceResetIds: resetIds(resets) }));
}

export function decodeSourceRevision(bytes) {
  const value = parseJson(bytes); let sourceResetIds = null;
  if (value && Object.hasOwn(value, 'sourceResetIds')) {
    sourceResetIds = resetIds(value.sourceResetIds); delete value.sourceResetIds;
  }
  return { record: validateRevision(value), sourceResetIds };
}

export function currentSourceRevisions(transfers, files) {
  const current = canonicalJson(resetFileIds(files));
  // Existing V1 files without transport scope remain readable. New uploads always carry their source generation.
  return transfers.filter(item => item.sourceResetIds === null || canonicalJson(item.sourceResetIds) === current).map(item => item.record);
}
