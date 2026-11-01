import { FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson } from '../sources/json.js';
import { validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';
import { RECORD_LIMITS, checkImmutableRecord, checkRecordRevision, recordCollection, recordDigest,
  recordAttachments, recordKey, recordReceipt, sameRecordCommit, validateRecordQuery, validateRecordTransaction } from './records.js';

const encoder = new TextEncoder();
const invalid = condition => requireValue(condition, 'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));

function openDatabase(name, create) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1); let failed = false;
    request.onupgradeneeded = () => create?.(request.result);
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new FleetError('storage-blocked', t('errors.storage.storageBlocked'))); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
  });
}

/** The new database has its own name. Opening it never upgrades or reads the old workspace payload. */
export class IndexedDbRecordStore {
  #db; #legacyName;
  constructor(db, legacyName = 'work-fleet-v1') { this.#db = db; this.#legacyName = legacyName; }
  static async open(name = 'work-fleet-records-v1', { legacyName = 'work-fleet-v1' } = {}) {
    const db = await openDatabase(name, database => {
      database.createObjectStore('profiles', { keyPath: 'profileId' });
      database.createObjectStore('attachments', { keyPath: ['profileId', 'id'] });
      const entries = database.createObjectStore('entries', { keyPath: ['profileId', 'collection', 'key'] });
      entries.createIndex('ordered', ['profileId', 'collection', 'ordinal', 'key']);
      entries.createIndex('entity', ['profileId', 'collection', 'entity', 'ordinal', 'key']);
    });
    return new IndexedDbRecordStore(db, legacyName);
  }
  close() { this.#db.close(); }
  #transaction(mode, work) {
    return new Promise((resolve, reject) => {
      let tx; let result; let failure;
      try { tx = this.#db.transaction(['profiles', 'entries', 'attachments'], mode, { durability: 'strict' }); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new FleetError('storage-aborted', t('errors.storage.storageAborted')));
      const context = { result: value => { result = value; }, fail: error => { failure = error; tx.abort(); } };
      try { work(tx, context); } catch (error) { context.fail(error); }
    });
  }
  async #legacy(profileId) {
    if (this.#legacyName === null) return false;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#legacyName); let absent = false, failed = false;
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onerror = () => absent ? resolve(null) : reject(request.error);
      request.onblocked = () => { failed = true; reject(new FleetError('storage-blocked', t('errors.storage.storageBlocked'))); };
      request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    });
    if (!db) return false;
    try {
      if (!db.objectStoreNames.contains('workspaces')) return false;
      return await new Promise((resolve, reject) => {
        const request = db.transaction('workspaces', 'readonly').objectStore('workspaces').getKey(profileId);
        request.onsuccess = () => resolve(request.result !== undefined); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async status(profileId) {
    invalid(recordKey(profileId));
    const result = await this.#transaction('readonly', (tx, context) => {
      const request = tx.objectStore('profiles').get(profileId);
      request.onsuccess = () => context.result(request.result ?? null);
    });
    return result ?? (await this.#legacy(profileId) ? { format: 'legacy-workspace', profileId } : null);
  }
  get(profileId, collection, key) {
    invalid(recordKey(profileId) && recordCollection(collection) && recordKey(key));
    return this.#transaction('readonly', (tx, context) => {
      const request = tx.objectStore('entries').get([profileId, collection, key]);
      request.onsuccess = () => {
        if (!request.result) return context.result(null);
        const { profileId: ignored, ...row } = request.result; context.result(row);
      };
    });
  }
  async commit(input, expectedRevision, { attachments = [] } = {}) {
    const transaction = validateRecordTransaction(input);
    // Byte arrays keep attachment persistence in the same transaction, including WebKit's abort path.
    const files = (await recordAttachments(attachments)).map(item => ({ profileId: transaction.profileId, ...item }));
    const digest = await recordDigest(transaction);
    if (expectedRevision === null) requireValue(!await this.#legacy(transaction.profileId),
      'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
    return this.#transaction('readwrite', (tx, context) => {
      const profiles = tx.objectStore('profiles'); const entries = tx.objectStore('entries');
      const current = profiles.get(transaction.profileId);
      current.onsuccess = () => {
        try {
          if (sameRecordCommit(current.result, transaction, digest)) return context.result(current.result);
          checkRecordRevision(current.result, expectedRevision);
          invalid(transaction.revision === (expectedRevision === null ? 0 : expectedRevision + 1));
          for (const row of transaction.puts) {
            if (row.collection !== 'history') entries.put({ profileId: transaction.profileId, ...row });
            else {
              const old = entries.get([transaction.profileId, row.collection, row.key]);
              old.onsuccess = () => {
                try {
                  checkImmutableRecord(old.result, row);
                  if (!old.result) entries.add({ profileId: transaction.profileId, ...row });
                } catch (error) { context.fail(error); }
              };
            }
          }
          for (const row of transaction.deletes) entries.delete([transaction.profileId, row.collection, row.key]);
          for (const id of transaction.attachmentDeletes ?? []) tx.objectStore('attachments').delete([transaction.profileId, id]);
          for (const file of files) tx.objectStore('attachments').put(file);
          const receipt = recordReceipt(transaction, digest); profiles.put(receipt); context.result(receipt);
        } catch (error) { context.fail(error); }
      };
    });
  }
  getAttachment(profileId, id) {
    invalid(recordKey(profileId) && validDigest(id));
    return this.#transaction('readonly', (tx, context) => {
      const request = tx.objectStore('attachments').get([profileId, id]);
      request.onsuccess = () => context.result(request.result
        ? new Blob([request.result.bytes], { type: 'application/octet-stream' }) : null);
    });
  }
  async page(profileId, input) {
    invalid(recordKey(profileId)); const query = validateRecordQuery(input);
    if (query.expectedRevision === null) requireValue((await this.status(profileId))?.format !== 'legacy-workspace',
      'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
    return this.#transaction('readonly', (tx, context) => {
      const current = tx.objectStore('profiles').get(profileId);
      current.onsuccess = () => {
        try {
          checkRecordRevision(current.result, query.expectedRevision);
          const rows = []; let bytes = 512;
          const prefix = [profileId, query.collection]; if (query.entity !== null) prefix.push(query.entity);
          const boundary = query.after ? [...prefix, query.after.ordinal, query.after.key] : null;
          const ascending = query.order === 'asc';
          const range = ascending ? IDBKeyRange.bound(boundary ?? prefix, [...prefix, []], boundary !== null, false)
            : IDBKeyRange.bound(prefix, boundary ?? [...prefix, []], false, boundary !== null);
          const index = tx.objectStore('entries').index(query.entity === null ? 'ordered' : 'entity');
          const request = query.keysOnly ? index.openKeyCursor(range, ascending ? 'next' : 'prev') : index.openCursor(range, ascending ? 'next' : 'prev');
          request.onsuccess = () => {
            try {
              const cursor = request.result;
              if (!cursor) return context.result({ revision: current.result?.revision ?? null, rows, next: null });
              const value = query.keysOnly ? { collection: query.collection, key: cursor.primaryKey.at(-1), ordinal: cursor.key.at(-2) } : cursor.value;
              const { profileId: ignored, ...row } = value;
              const size = encoder.encode(canonicalJson(row)).length;
              if (rows.length >= query.limit || (rows.length && bytes + size > RECORD_LIMITS.pageBytes)) {
                const last = rows.at(-1);
                return context.result({ revision: current.result?.revision ?? null, rows, next: { ordinal: last.ordinal, key: last.key } });
              }
              rows.push(row); bytes += size + 1; cursor.continue();
            } catch (error) { context.fail(error); }
          };
        } catch (error) { context.fail(error); }
      };
    });
  }
  /** Called only by the profile's explicit local-reset flow, never by open or format detection. */
  reset(profileId) {
    invalid(recordKey(profileId));
    return this.#transaction('readwrite', tx => {
      tx.objectStore('profiles').delete(profileId);
      tx.objectStore('entries').delete(IDBKeyRange.bound([profileId], [profileId, []]));
      tx.objectStore('attachments').delete(IDBKeyRange.bound([profileId], [profileId, []]));
    });
  }
}
