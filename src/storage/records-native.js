import { requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { sha256 } from '../sources/files.js';
import { t } from '../i18n/index.js';
import { NativeStorage, NativeTransfers } from './native.js';
import { RECORD_LIMITS, recordAttachments, recordCollection, recordKey, sameRecordCommit,
  validateLocalRecord, validateRecordPage, validateRecordQuery, validateRecordStatus, validateRecordTransaction } from './records.js';

const encoder = new TextEncoder();

/** Small typed transactions and indexed reads over the existing session-bound transfer mechanism. */
export class NativeRecordStore {
  #bridge; #profile; #transfers; #files;
  constructor(bridge, info) {
    this.#bridge = bridge; this.#profile = info.profileId; this.#transfers = new NativeTransfers(bridge, info);
    this.#files = new NativeStorage(bridge, info);
  }
  #check(profileId) { requireValue(profileId === this.#profile, 'invalid-profile', t('errors.storage.profileMismatch')); }
  async status(profileId) {
    this.#check(profileId); return validateRecordStatus(await this.#bridge.request('storage.records.status', {}), profileId);
  }
  async get(profileId, collection, key) {
    this.#check(profileId);
    requireValue(recordCollection(collection) && recordKey(key), 'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
    const bytes = await this.#transfers.download('storage.records.get', { collection, key }, RECORD_LIMITS.pageBytes);
    const row = bytes === null ? null : parseJson(bytes);
    requireValue(row === null || (row.collection === collection && row.key === key),
      'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
    return row === null ? null : validateLocalRecord(row);
  }
  async page(profileId, input) {
    this.#check(profileId); const query = validateRecordQuery(input);
    const result = parseJson(await this.#transfers.download('storage.records.page', query, RECORD_LIMITS.pageBytes));
    return validateRecordPage(result, query);
  }
  async commit(input, expectedRevision, { attachments = [] } = {}) {
    const transaction = validateRecordTransaction(input); this.#check(transaction.profileId);
    requireValue(expectedRevision === null || Number.isSafeInteger(expectedRevision) && expectedRevision >= 0,
      'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
    attachments = await recordAttachments(attachments);
    const bytes = encoder.encode(canonicalJson(transaction)); const digest = await sha256(bytes);
    const tokens = []; let token;
    try {
      for (const item of attachments) {
        tokens.push(await this.#transfers.upload('attachment', item.bytes));
      }
      token = await this.#transfers.upload('workspace', bytes);
      let result;
      try { result = await this.#bridge.request('storage.records.commit', { token, expectedRevision, attachments: tokens }); }
      catch (error) {
        if (error.code !== 'native-outcome-unknown') throw error;
        result = await this.status(transaction.profileId).catch(() => null);
        if (!sameRecordCommit(result, transaction, digest)) throw error;
      }
      requireValue(sameRecordCommit(result, transaction, digest), 'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
      return result;
    } finally {
      await this.#transfers.discard(token);
      for (const attachment of tokens) await this.#transfers.discard(attachment);
    }
  }
  getAttachment(profileId, id) { return this.#files.getAttachment(profileId, id); }
}
