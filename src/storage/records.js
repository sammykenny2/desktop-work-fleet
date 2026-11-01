import { copy, requireValue, safeKey } from '../core/contracts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { sha256, validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';

export const RECORD_FORMAT = 'work-fleet-local-records';
export const TRANSACTION_FORMAT = 'work-fleet-record-transaction';
export const RECORD_COLLECTIONS = Object.freeze(['meta', 'current', 'history', 'draft', 'outbox', 'control', 'job']);
export const RECORD_LIMITS = Object.freeze({ rows: 512, rowBytes: 8 * 1024 * 1024 - 1024,
  transactionBytes: 8 * 1024 * 1024, pageRows: 100, pageBytes: 8 * 1024 * 1024,
  attachmentBytes: 25 * 1024 * 1024, attachmentBatchBytes: 128 * 1024 * 1024 });
const encoder = new TextEncoder();
const invalid = condition => requireValue(condition, 'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const recordKey = value => safeKey(value) && typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(value);
export const recordCollection = value => RECORD_COLLECTIONS.includes(value);
export const rowIdentity = row => JSON.stringify([row.collection, row.key]);
const version = value => Number.isSafeInteger(value) && value >= 0;
const commitId = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

export function validateLocalRecord(row) {
  invalid(exact(row, ['collection', 'key', 'entity', 'ordinal', 'value']) && recordCollection(row.collection)
    && recordKey(row.key) && (row.entity === '' || recordKey(row.entity)) && version(row.ordinal));
  requireValue(encoder.encode(canonicalJson(row)).length <= RECORD_LIMITS.rowBytes,
    'native-capacity', t('errors.storage.nativeCapacity'));
  return row;
}

export function validateRecordStatus(status, profileId) {
  invalid(recordKey(profileId));
  if (status === null) return null;
  invalid(status?.profileId === profileId);
  if (status.format === 'legacy-workspace') invalid(exact(status, ['format', 'profileId']));
  else invalid(exact(status, ['format', 'schemaVersion', 'profileId', 'revision', 'commitId', 'digest'])
    && status.format === RECORD_FORMAT && status.schemaVersion === 1 && version(status.revision)
    && commitId(status.commitId) && validDigest(status.digest));
  return status;
}

export function validateRecordPage(page, input) {
  const query = validateRecordQuery(input);
  invalid(exact(page, ['revision', 'rows', 'next']) && page.revision === query.expectedRevision
    && Array.isArray(page.rows) && page.rows.length <= query.limit);
  let previous = query.after;
  for (const row of page.rows) {
    validateLocalRecord(row);
    invalid(row.collection === query.collection && (query.entity === null || row.entity === query.entity)
      && page.revision !== null && row.ordinal <= page.revision
      && (!previous || (query.order === 'asc'
        ? row.ordinal > previous.ordinal || (row.ordinal === previous.ordinal && row.key > previous.key)
        : row.ordinal < previous.ordinal || (row.ordinal === previous.ordinal && row.key < previous.key))));
    previous = row;
  }
  if (page.next !== null) {
    validateRecordQuery({ ...query, after: page.next });
    invalid(page.rows.length > 0 && page.next.ordinal === previous.ordinal && page.next.key === previous.key);
  }
  return page;
}

export async function recordAttachments(input) {
  requireValue(Array.isArray(input) && input.length <= RECORD_LIMITS.rows, 'invalid-attachment', t('errors.storage.attachmentListInvalid'));
  const seen = new Set(); let size = 0;
  for (const item of input) {
    requireValue(item?.bytes instanceof Uint8Array && item.bytes.length <= RECORD_LIMITS.attachmentBytes
      && validDigest(item.id) && !seen.has(item.id), 'invalid-attachment', t('errors.storage.attachmentIdOrSizeInvalid'));
    seen.add(item.id); size += item.bytes.length;
    requireValue(size <= RECORD_LIMITS.attachmentBatchBytes, 'native-capacity', t('errors.storage.nativeCapacity'));
  }
  const items = input.map(item => ({ id: item.id, bytes: new Uint8Array(item.bytes) }));
  for (const item of items) requireValue(await sha256(item.bytes) === item.id, 'attachment-integrity', t('errors.common.attachmentChecksumMismatch'));
  return items;
}

/** Validate before crossing a storage boundary; no paths, SQL or caller-selected table names are accepted. */
export function validateRecordTransaction(input) {
  const encoded = canonicalJson(input);
  requireValue(encoder.encode(encoded).length <= RECORD_LIMITS.transactionBytes, 'native-capacity', t('errors.storage.nativeCapacity'));
  const transaction = parseJson(encoded);
  invalid(exact(transaction, ['format', 'schemaVersion', 'profileId', 'revision', 'commitId', 'puts', 'deletes'])
    && transaction.format === TRANSACTION_FORMAT && transaction.schemaVersion === 1 && recordKey(transaction.profileId)
    && version(transaction.revision) && commitId(transaction.commitId));
  invalid(Array.isArray(transaction.puts) && Array.isArray(transaction.deletes)
    && transaction.puts.length + transaction.deletes.length <= RECORD_LIMITS.rows);
  const seen = new Set();
  for (const row of transaction.puts) {
    validateLocalRecord(row); invalid(row.ordinal <= transaction.revision);
    invalid(!seen.has(rowIdentity(row))); seen.add(rowIdentity(row));
  }
  for (const row of transaction.deletes) {
    invalid(exact(row, ['collection', 'key']) && recordCollection(row.collection) && recordKey(row.key));
    invalid(!seen.has(rowIdentity(row))); seen.add(rowIdentity(row));
  }
  return transaction;
}

export function recordTransaction(profileId, expectedRevision, puts = [], deletes = [], commitId = crypto.randomUUID()) {
  invalid(expectedRevision === null || version(expectedRevision));
  return validateRecordTransaction({ format: TRANSACTION_FORMAT, schemaVersion: 1, profileId,
    revision: expectedRevision === null ? 0 : expectedRevision + 1, commitId, puts, deletes });
}

export function validateRecordQuery(input) {
  const query = { collection: input?.collection, entity: input?.entity ?? null, after: input?.after ?? null,
    limit: input?.limit ?? RECORD_LIMITS.pageRows, expectedRevision: input?.expectedRevision ?? null, order: input?.order ?? 'desc' };
  invalid(input && Object.keys(input).every(key => Object.hasOwn(query, key)) && recordCollection(query.collection)
    && (query.entity === null || query.entity === '' || recordKey(query.entity))
    && Number.isInteger(query.limit) && query.limit > 0 && query.limit <= RECORD_LIMITS.pageRows
    && (query.expectedRevision === null || version(query.expectedRevision)) && ['asc', 'desc'].includes(query.order));
  if (query.after !== null) invalid(exact(query.after, ['ordinal', 'key']) && version(query.after.ordinal) && recordKey(query.after.key));
  return copy(query);
}

export const recordDigest = transaction => sha256(encoder.encode(canonicalJson(validateRecordTransaction(transaction))));

export function checkRecordRevision(status, expectedRevision) {
  requireValue((status?.revision ?? null) === expectedRevision, 'stale-writer', t('errors.storage.staleWriter'));
}

export function recordReceipt(transaction, digest) {
  return { format: RECORD_FORMAT, schemaVersion: 1, profileId: transaction.profileId,
    revision: transaction.revision, commitId: transaction.commitId, digest };
}

/** A lost acknowledgement is confirmed by the exact transaction, never just its revision number. */
export function sameRecordCommit(status, transaction, digest) {
  return status?.format === RECORD_FORMAT && status.schemaVersion === 1 && status.profileId === transaction.profileId
    && status.revision === transaction.revision && status.commitId === transaction.commitId && status.digest === digest;
}

export function checkImmutableRecord(existing, next) {
  if (next.collection !== 'history' || !existing) return;
  requireValue(existing.entity === next.entity && canonicalJson(existing.value) === canonicalJson(next.value),
    'revision-collision', t('errors.common.revisionCollision'));
}

/** Reference adapter for isolated model tests. It never clones the untouched record map during a commit. */
export class MemoryRecordStore {
  #profiles = new Map();
  #tail = Promise.resolve();
  #stats = { reads: 0, writes: 0 };
  get stats() { return copy(this.#stats); }
  async status(profileId) { invalid(recordKey(profileId)); return copy(this.#profiles.get(profileId)?.status ?? null); }
  async get(profileId, collection, key) {
    invalid(recordKey(profileId) && recordCollection(collection) && recordKey(key));
    this.#stats.reads++;
    return copy(this.#profiles.get(profileId)?.rows.get(rowIdentity({ collection, key })) ?? null);
  }
  async commit(input, expectedRevision, { attachments = [] } = {}) {
    const transaction = validateRecordTransaction(input); const files = await recordAttachments(attachments);
    const digest = await recordDigest(transaction);
    const work = this.#tail.then(() => {
      const profile = this.#profiles.get(transaction.profileId) ?? { status: null, rows: new Map(), attachments: new Map() };
      if (sameRecordCommit(profile.status, transaction, digest)) return copy(profile.status);
      checkRecordRevision(profile.status, expectedRevision);
      invalid(transaction.revision === (expectedRevision === null ? 0 : expectedRevision + 1));
      for (const row of transaction.puts) checkImmutableRecord(profile.rows.get(rowIdentity(row)), row);
      for (const row of transaction.puts) {
        const id = rowIdentity(row);
        if (row.collection !== 'history' || !profile.rows.has(id)) { profile.rows.set(id, row); this.#stats.writes++; }
      }
      for (const row of transaction.deletes) { profile.rows.delete(rowIdentity(row)); this.#stats.writes++; }
      for (const item of files) profile.attachments.set(item.id, item.bytes);
      profile.status = recordReceipt(transaction, digest); this.#profiles.set(transaction.profileId, profile);
      return copy(profile.status);
    });
    this.#tail = work.catch(() => {}); return work;
  }
  async getAttachment(profileId, id) {
    invalid(recordKey(profileId) && validDigest(id));
    const bytes = this.#profiles.get(profileId)?.attachments.get(id);
    return bytes ? new Blob([bytes], { type: 'application/octet-stream' }) : null;
  }
  async page(profileId, input) {
    invalid(recordKey(profileId));
    const query = validateRecordQuery(input); const profile = this.#profiles.get(profileId);
    checkRecordRevision(profile?.status, query.expectedRevision);
    // Only the reference adapter sorts in memory. Persistent adapters use the entity/ordinal index.
    const matches = [...(profile?.rows.values() ?? [])].filter(row => row.collection === query.collection
      && (query.entity === null || row.entity === query.entity)
      && (!query.after || (query.order === 'asc'
        ? row.ordinal > query.after.ordinal || (row.ordinal === query.after.ordinal && row.key > query.after.key)
        : row.ordinal < query.after.ordinal || (row.ordinal === query.after.ordinal && row.key < query.after.key))))
      .sort((a, b) => (query.order === 'asc' ? -1 : 1) * (b.ordinal - a.ordinal || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)));
    const rows = []; let bytes = 512;
    for (const row of matches.slice(0, query.limit)) {
      const size = encoder.encode(canonicalJson(row)).length;
      if (rows.length && bytes + size > RECORD_LIMITS.pageBytes) break;
      rows.push(copy(row)); bytes += size + 1;
    }
    this.#stats.reads += rows.length;
    const last = rows.at(-1);
    return { revision: profile?.status?.revision ?? null, rows,
      next: matches.length > rows.length && last ? { ordinal: last.ordinal, key: last.key } : null };
  }
}
