import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { validId, validateRevision } from './revisions.js';
import { CurrentRevisions } from './current-revisions.js';
import { sha256, validDigest, validFileId } from './files.js';
import { t } from '../i18n/index.js';

export const DATASET_FORMAT = 'work-fleet-dataset';
export const DATASET_SHARDS = Object.freeze([...Array.from({ length: 16 }, (_, i) => i.toString(16)), 'groups']);
export const DATASET_LIMITS = Object.freeze({ checkpointBytes: 8 * 1024 * 1024, tailSoft: 64, tailHard: 128,
  candidates: 8, writers: 8, inputs: 151, feedEvents: 1000, feedBytes: 8 * 1024 * 1024, queryEntities: 20 });
export const DATASET_FIELDS = 'id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum';
const folders = new Set(['dataset-root', 'folder']);
const kinds = new Set([...folders, 'dataset', 'ready', 'revision', 'attachment', 'change', 'checkpoint', 'purge']);
const encoder = new TextEncoder();
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const unique = values => new Set(values).size === values.length;
export const datasetId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
export const datasetFileLimit = kind => kind === 'attachment' ? 25 * 1024 * 1024
  : ['change', 'purge', 'dataset', 'ready'].includes(kind) ? 64 * 1024 : DATASET_LIMITS.checkpointBytes;
export const datasetShard = async (kind, id) => kind === 'group' ? 'groups' : (await sha256(encoder.encode(id)))[0];

export function validateDatasetFile(input) {
  const file = copy(input);
  invalid(file && validFileId(file.id) && datasetId(file.datasetId) && kinds.has(file.kind) && validFileId(file.parentId));
  const keys = ['id', 'datasetId', 'kind', 'parentId'];
  if (folders.has(file.kind)) {
    keys.push('role'); invalid(typeof file.role === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(file.role));
    if (file.entityId !== undefined) { keys.push('entityId'); invalid(validId(file.entityId)); }
    invalid(file.kind !== 'dataset-root' || (file.parentId === 'appDataFolder' && file.role === 'root'));
  } else {
    keys.push('sha256', 'size'); invalid(validDigest(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= datasetFileLimit(file.kind));
    if (['revision', 'attachment', 'change', 'purge'].includes(file.kind)) { keys.push('entityId'); invalid(validId(file.entityId)); }
    if (['revision', 'change'].includes(file.kind)) { keys.push('revisionId'); invalid(validId(file.revisionId)); }
    if (['revision', 'change', 'checkpoint', 'purge'].includes(file.kind)) { keys.push('shard'); invalid(DATASET_SHARDS.includes(file.shard)); }
  }
  invalid(exact(file, keys));
  const properties = datasetProperties(file);
  invalid(Object.entries(properties).every(([key, value]) => encoder.encode(key + value).length <= 124));
  return file;
}

function datasetProperties(file) {
  return { wfFormat: DATASET_FORMAT, wfSchema: '1', wfDataset: file.datasetId, wfKind: file.kind,
    ...(file.sha256 ? { wfSha256: file.sha256 } : {}), ...(file.role ? { wfRole: file.role } : {}),
    ...(file.entityId ? { wfEntity: file.entityId } : {}), ...(file.revisionId ? { wfRevision: file.revisionId } : {}),
    ...(file.shard ? { wfShard: file.shard } : {}) };
}

export function datasetMetadata(input) {
  const file = validateDatasetFile(input);
  return { id: file.id, name: `${file.kind}-${file.revisionId ?? file.entityId ?? file.id}${folders.has(file.kind) ? '' : file.kind === 'attachment' ? '.bin' : '.json'}`,
    mimeType: folders.has(file.kind) ? 'application/vnd.google-apps.folder' : 'application/octet-stream',
    parents: [file.parentId], appProperties: datasetProperties(file) };
}

export function googleDatasetDescriptor(metadata, { rootParentVerified = false } = {}) {
  const properties = metadata?.appProperties;
  invalid(metadata && metadata.trashed !== true && metadata.spaces?.includes('appDataFolder')
    && Array.isArray(metadata.parents) && metadata.parents.length === 1
    && properties?.wfFormat === DATASET_FORMAT && properties.wfSchema === '1');
  const file = { id: metadata.id, parentId: metadata.parents[0], datasetId: properties.wfDataset, kind: properties.wfKind };
  if (file.kind === 'dataset-root') {
    // Drive can return the real app-data folder ID instead of its request alias. A scoped parent query proves it.
    invalid(file.parentId === 'appDataFolder' || rootParentVerified); file.parentId = 'appDataFolder';
  }
  if (folders.has(file.kind)) file.role = properties.wfRole;
  else {
    invalid(typeof metadata.size === 'string' && /^(0|[1-9][0-9]*)$/.test(metadata.size));
    file.size = Number(metadata.size); file.sha256 = properties.wfSha256;
    invalid(metadata.sha256Checksum === undefined || metadata.sha256Checksum === file.sha256);
  }
  for (const [property, key] of [['wfEntity', 'entityId'], ['wfRevision', 'revisionId'], ['wfShard', 'shard']]) {
    if (properties[property] !== undefined) file[key] = properties[property];
  }
  validateDatasetFile(file);
  invalid(metadata.mimeType === datasetMetadata(file).mimeType && canonicalJson(properties) === canonicalJson(datasetProperties(file)));
  return file;
}

/** A typed selector, never caller-provided Drive query text. Values cannot contain query punctuation. */
export function datasetQuery(input) {
  const query = copy(input); invalid(query && typeof query.scope === 'string');
  const keys = ['scope']; const clauses = ['trashed = false'];
  const prop = (key, value) => `appProperties has { key='${key}' and value='${value}' }`;
  if (query.scope === 'fences') clauses.push(prop('wfKind', 'reset'));
  else if (query.scope !== 'legacy') {
    clauses.push(prop('wfFormat', DATASET_FORMAT));
    if (query.scope !== 'datasets') {
      keys.push('datasetId'); invalid(datasetId(query.datasetId)); clauses.push(prop('wfDataset', query.datasetId));
    }
    if (query.scope === 'datasets') clauses.push(prop('wfKind', 'dataset'));
    else if (query.scope === 'ready') clauses.push(prop('wfKind', 'ready'));
    else if (query.scope === 'roots') { clauses.push(prop('wfKind', 'dataset-root')); clauses.push("'appDataFolder' in parents"); }
    else if (query.scope === 'current') {
      keys.push('shard'); invalid(DATASET_SHARDS.includes(query.shard)); clauses.push(prop('wfShard', query.shard));
      clauses.push(`(${prop('wfKind', 'checkpoint')} or ${prop('wfKind', 'change')})`);
    } else if (query.scope === 'history' || query.scope === 'children') {
      keys.push('parentId'); invalid(validFileId(query.parentId)); clauses.push(`'${query.parentId}' in parents`);
      if (query.scope === 'history') clauses.push(prop('wfKind', 'revision'));
    } else if (query.scope === 'purges' || query.scope === 'entity-folders') {
      keys.push('entities'); invalid(Array.isArray(query.entities) && query.entities.length > 0
        && query.entities.length <= DATASET_LIMITS.queryEntities && unique(query.entities) && query.entities.every(validId));
      clauses.push(prop('wfKind', query.scope === 'purges' ? 'purge' : 'folder'));
      clauses.push(`(${query.entities.map(id => prop('wfEntity', id)).join(' or ')})`);
    } else invalid(false);
  }
  invalid(exact(query, keys)); return clauses.join(' and ');
}

const reference = value => exact(value, ['id', 'sha256']) && validFileId(value.id) && validDigest(value.sha256);
function attachmentLocations(record, files, dataset, parentId) {
  invalid(Array.isArray(files) && unique(files.map(file => file.sha256)));
  for (const file of files) {
    validateDatasetFile(file);
    invalid(file.kind === 'attachment' && file.datasetId === dataset && file.entityId === record.entityId && file.parentId === parentId);
  }
  const expected = [...new Set((record.value.content?.attachments ?? []).map(item => item.id))].sort();
  invalid(canonicalJson(files.map(file => file.sha256).sort()) === canonicalJson(expected));
}
function head(value, dataset, shard) {
  invalid(exact(value, ['record', 'file', 'attachments']));
  const record = validateRevision(value.record), file = validateDatasetFile(value.file);
  invalid(file.datasetId === dataset && file.kind === 'revision' && file.entityId === record.entityId
    && file.revisionId === record.revisionId && file.shard === shard);
  attachmentLocations(record, value.attachments, dataset, file.parentId);
}

export function validateDatasetRecord(input) {
  const value = parseJson(canonicalJson(input));
  invalid(value?.format === DATASET_FORMAT && value.schemaVersion === 1 && datasetId(value.datasetId));
  const keys = ['format', 'schemaVersion', 'datasetId', 'kind'];
  if (value.kind === 'revision') {
    keys.push('record', 'attachments'); const record = validateRevision(value.record);
    invalid(Array.isArray(value.attachments));
    for (const file of value.attachments) { validateDatasetFile(file); invalid(file.datasetId === value.datasetId && file.entityId === record.entityId && file.kind === 'attachment'); }
  } else if (value.kind === 'change') {
    keys.push('revision'); const file = validateDatasetFile(value.revision); invalid(file.kind === 'revision' && file.datasetId === value.datasetId);
  } else if (value.kind === 'checkpoint') {
    keys.push('operationId', 'shard', 'inputs', 'heads');
    invalid(datasetId(value.operationId) && DATASET_SHARDS.includes(value.shard) && Array.isArray(value.inputs)
      && value.inputs.length <= DATASET_LIMITS.inputs && value.inputs.every(reference) && unique(value.inputs.map(item => item.id))
      && Array.isArray(value.heads) && unique(value.heads.map(item => item.record?.revisionId)));
    for (const item of value.heads) head(item, value.datasetId, value.shard);
    invalid(new CurrentRevisions(value.heads.map(item => item.record)).size === value.heads.length);
  } else if (value.kind === 'purge') {
    keys.push('operationId', 'entityId', 'folderIds', 'trashEpisode', 'heads');
    invalid(datasetId(value.operationId) && validId(value.entityId) && validId(value.trashEpisode)
      && Array.isArray(value.folderIds) && value.folderIds.length <= 32 && value.folderIds.every(validFileId) && unique(value.folderIds)
      && Array.isArray(value.heads) && value.heads.length > 0 && value.heads.length <= 1024 && value.heads.every(validId) && unique(value.heads));
  } else if (value.kind === 'dataset') {
    keys.push('rootId', 'readyId', 'fenceId', 'folders');
    invalid(validFileId(value.rootId) && validFileId(value.readyId) && (value.fenceId === null || validFileId(value.fenceId))
      && exact(value.folders, ['notes', 'groups', 'current', 'purges', 'shards', 'buckets'])
      && exact(value.folders.shards, DATASET_SHARDS) && exact(value.folders.buckets, DATASET_SHARDS.filter(id => id !== 'groups')));
    const ids = [value.rootId, value.readyId, ...['notes', 'groups', 'current', 'purges'].map(key => value.folders[key]),
      ...Object.values(value.folders.shards), ...Object.values(value.folders.buckets)];
    invalid(ids.every(validFileId) && unique(ids));
  } else if (value.kind === 'ready') {
    keys.push('descriptor', 'initial'); invalid(reference(value.descriptor) && Array.isArray(value.initial)
      && value.initial.length === DATASET_SHARDS.length && unique(value.initial.map(file => file.shard)));
    for (const file of value.initial) { validateDatasetFile(file); invalid(file.kind === 'checkpoint' && file.datasetId === value.datasetId); }
  } else invalid(false);
  invalid(exact(value, keys)); return value;
}

export const datasetRecord = (dataset, kind, fields) => validateDatasetRecord({ format: DATASET_FORMAT, schemaVersion: 1, datasetId: dataset, kind, ...fields });
export const encodeDatasetRecord = value => encoder.encode(canonicalJson(validateDatasetRecord(value)));

export async function datasetFile(id, parentId, value) {
  const bytes = encodeDatasetRecord(value);
  const file = { id, parentId, datasetId: value.datasetId, kind: value.kind, size: bytes.length, sha256: await sha256(bytes) };
  if (value.kind === 'revision') Object.assign(file, { entityId: value.record.entityId, revisionId: value.record.revisionId, shard: await datasetShard(value.record.kind, value.record.entityId) });
  if (value.kind === 'change') Object.assign(file, { entityId: value.revision.entityId, revisionId: value.revision.revisionId, shard: value.revision.shard });
  if (value.kind === 'checkpoint') file.shard = value.shard;
  if (value.kind === 'purge') Object.assign(file, { entityId: value.entityId, shard: await datasetShard('card', value.entityId) });
  return { file: validateDatasetFile(file), bytes };
}

export async function verifyDatasetBytes(input, bytes) {
  const file = validateDatasetFile(input);
  invalid(!folders.has(file.kind) && bytes instanceof Uint8Array);
  requireValue(bytes.length === file.size && await sha256(bytes) === file.sha256, 'file-integrity', t('errors.sources.fileIntegrity'));
  return new Uint8Array(bytes);
}

export async function decodeDatasetRecord(file, input) {
  const bytes = await verifyDatasetBytes(file, input), value = validateDatasetRecord(parseJson(bytes));
  invalid(value.kind === file.kind && value.datasetId === file.datasetId);
  if (value.kind === 'revision') {
    invalid(value.record.entityId === file.entityId && value.record.revisionId === file.revisionId
      && await datasetShard(value.record.kind, value.record.entityId) === file.shard);
    attachmentLocations(value.record, value.attachments, file.datasetId, file.parentId);
  }
  if (value.kind === 'change') invalid(value.revision.entityId === file.entityId && value.revision.revisionId === file.revisionId && value.revision.shard === file.shard);
  if (value.kind === 'checkpoint') {
    invalid(value.shard === file.shard && value.inputs.every(input => input.id !== file.id));
    for (const item of value.heads) invalid(await datasetShard(item.record.kind, item.record.entityId) === value.shard);
  }
  if (value.kind === 'purge') invalid(value.entityId === file.entityId && await datasetShard('card', value.entityId) === file.shard);
  return value;
}
