import { compareId, copy, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { sha256, validDigest, validFileId } from './files.js';
import { encodeRevision, validId } from './revisions.js';
import { initialGroupRecord } from './initial-group.js';

export const initializationProtocol = 'workspace-init-v1';
export const encodeInitialization = value => new TextEncoder().encode(canonicalJson(value));
const exact = (value, keys) => value && canonicalJson(Object.keys(value).sort()) === canonicalJson(keys.sort());
const invalid = value => requireValue(value, 'invalid-initialization', '工作空間初始化紀錄無效，資料仍保留。');

export async function workspaceIdentity(sourceId) {
  return sha256(new TextEncoder().encode(canonicalJson(['work-fleet-workspace', sourceId])));
}

export async function prepareInitialization(sourceId, sourceResetIds, { mode = 'starter', origin = 'bootstrap', records = [], attachments = [] } = {}) {
  sourceResetIds = [...sourceResetIds].sort();
  if (mode === 'starter') records = [await initialGroupRecord(sourceId, sourceResetIds)];
  invalid(records.every(record => (record.value.content?.attachments || []).every(file => attachments.includes(file.id))));
  const revisions = await Promise.all(records.map(async record => ({ id: record.revisionId, sha256: await sha256(encodeRevision(record)) })));
  return validateInitialization({ format: 'work-fleet-workspace', schemaVersion: 1, phase: 'prepare',
    workspaceId: await workspaceIdentity(sourceId), sourceResetIds, mode, origin,
    revisions: revisions.sort((a, b) => compareId(a.id, b.id)), attachments: [...new Set(attachments)].sort() }, sourceId);
}

export async function validateInitialization(input, sourceId) {
  const value = copy(input);
  invalid(value?.format === 'work-fleet-workspace' && value.schemaVersion === 1
    && value.workspaceId === await workspaceIdentity(sourceId));
  invalid(Array.isArray(value.sourceResetIds) && value.sourceResetIds.every(validFileId)
    && new Set(value.sourceResetIds).size === value.sourceResetIds.length
    && canonicalJson(value.sourceResetIds) === canonicalJson([...value.sourceResetIds].sort()));
  if (value.phase === 'prepare') {
    invalid(exact(value, ['format', 'schemaVersion', 'phase', 'workspaceId', 'sourceResetIds', 'mode', 'origin', 'revisions', 'attachments'])
      && ['starter', 'existing', 'restore'].includes(value.mode) && ['bootstrap', 'reset'].includes(value.origin));
    invalid(Array.isArray(value.revisions) && value.revisions.length <= 20000
      && value.revisions.every(item => exact(item, ['id', 'sha256']) && validId(item.id) && validDigest(item.sha256))
      && new Set(value.revisions.map(item => item.id)).size === value.revisions.length);
    invalid(canonicalJson(value.revisions) === canonicalJson([...value.revisions].sort((a, b) => compareId(a.id, b.id))));
    invalid(Array.isArray(value.attachments) && value.attachments.length <= 20000 && value.attachments.every(validDigest)
      && new Set(value.attachments).size === value.attachments.length);
    invalid(canonicalJson(value.attachments) === canonicalJson([...value.attachments].sort()));
    if (value.mode === 'existing') invalid(!value.revisions.length && !value.attachments.length && value.origin === 'bootstrap');
    if (value.mode === 'starter') {
      const root = await initialGroupRecord(sourceId, value.sourceResetIds);
      invalid(value.revisions.length === 1 && value.revisions[0].id === root.revisionId
        && value.revisions[0].sha256 === await sha256(encodeRevision(root)) && !value.attachments.length);
    }
  } else invalid(value.phase === 'ready' && exact(value, ['format', 'schemaVersion', 'phase', 'workspaceId', 'sourceResetIds', 'planId']) && validDigest(value.planId));
  return value;
}

export const decodeInitialization = (bytes, sourceId) => validateInitialization(parseJson(bytes), sourceId);
export const initializationId = value => sha256(encodeInitialization(value));
export async function initializationReceipt(plan) {
  return { format: plan.format, schemaVersion: 1, phase: 'ready', workspaceId: plan.workspaceId,
    sourceResetIds: copy(plan.sourceResetIds), planId: await initializationId(plan) };
}

export async function initializationComplete(plan, records, files) {
  const known = new Map(records.map(record => [record.revisionId, record]));
  const attachments = new Set(Object.values(files || {}).filter(file => file.kind === 'attachment').map(file => file.sha256));
  for (const requirement of plan.revisions) {
    const record = known.get(requirement.id);
    if (!record) return false;
    invalid(await sha256(encodeRevision(record)) === requirement.sha256);
    invalid((record.value.content?.attachments || []).every(file => plan.attachments.includes(file.id)));
  }
  return plan.attachments.every(id => attachments.has(id));
}
