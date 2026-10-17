import { FleetError, requireValue } from '../core/contracts.js';
import { NativeTransfers } from '../storage/native.js';
import { driveFolder, googleDescriptor } from '../sources/google-drive.js';
import { validateFile, verifyFile, validFileId } from '../sources/files.js';
import { t } from '../i18n/index.js';

const cursor = value => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192, 'invalid-source-page', t('errors.storage.googleCursorInvalid')); return value;
};
const page = value => { requireValue(Array.isArray(value) && value.length <= 1000, 'invalid-source-page', t('errors.storage.googlePageInvalid')); return value; };

/** Semantic FileStore only: credentials, URLs and HTTP authorization remain in the native service. */
export class NativeGoogleFileStore {
  #bridge; #account; #transfers;
  constructor(bridge, info, accountId) {
    requireValue(/^[A-Za-z0-9_-]{1,255}$/.test(accountId) && info.profileId === `google:${accountId}`, 'invalid-source', t('errors.storage.googleAccountRequired'));
    this.#bridge = bridge; this.#account = accountId; this.#transfers = new NativeTransfers(bridge, info);
  }
  get sourceId() { return `google-drive:${this.#account}:appdata-v1`; }
  async #call(method, args, signal) {
    if (signal?.aborted) throw new FleetError('stale-session', t('errors.storage.googleSessionEnded'));
    const result = await this.#bridge.request(method, { accountId: this.#account, ...args });
    if (signal?.aborted) throw new FleetError('stale-session', t('errors.storage.googleSessionEnded'));
    return result;
  }
  async getStartCursor({ signal } = {}) { return cursor((await this.#call('google.cursor', {}, signal)).startPageToken); }
  async listFiles({ pageToken = null, signal } = {}) {
    const result = await this.#call('google.list', { pageToken: pageToken === null ? null : cursor(pageToken) }, signal);
    requireValue(result.incompleteSearch === undefined || typeof result.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.storage.googleListingStateInvalid'));
    return { files: page(result.files || []).map(googleDescriptor), incomplete: result.incompleteSearch === true,
      nextPageToken: result.nextPageToken === undefined ? null : cursor(result.nextPageToken) };
  }
  async listChanges({ cursor: current, signal }) {
    const result = await this.#call('google.changes', { cursor: cursor(current) }, signal);
    requireValue(!(result.nextPageToken !== undefined && result.newStartPageToken !== undefined), 'invalid-source-page', t('errors.storage.googlePageEndInvalid'));
    const changes = page(result.changes || []).map(change => {
      requireValue(validFileId(change?.fileId) && (change.removed === undefined || typeof change.removed === 'boolean'), 'invalid-source-page', t('errors.storage.googleChangeInvalid'));
      if (change.removed || change.file?.trashed) return { id: change.fileId, removed: true };
      if (driveFolder(change.file)) return null;
      const file = googleDescriptor(change.file);
      requireValue(file.id === change.fileId, 'invalid-source-page', t('errors.storage.googleFileMismatch')); return { id: change.fileId, removed: false, file };
    }).filter(Boolean);
    return { changes, ...(result.nextPageToken === undefined ? { cursor: cursor(result.newStartPageToken) } : { nextCursor: cursor(result.nextPageToken) }) };
  }
  // Ids only, so a reset can delete files this version cannot read.
  async listFileIds({ pageToken = null, signal } = {}) {
    const result = await this.#call('google.list', { pageToken: pageToken === null ? null : cursor(pageToken) }, signal);
    requireValue(result.incompleteSearch === undefined || typeof result.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.storage.googleListingStateInvalid'));
    return { ids: page(result.files || []).map(file => { requireValue(validFileId(file?.id), 'invalid-source-page', t('errors.storage.googleFileIdInvalid')); return file.id; }),
      incomplete: result.incompleteSearch === true,
      resetIds: (result.files || []).filter(file => file.appProperties?.wfKind === 'reset').map(file => file.id),
      nextPageToken: result.nextPageToken === undefined ? null : cursor(result.nextPageToken) };
  }
  async deleteFile({ id, signal }) {
    requireValue(validFileId(id), 'invalid-source-file', t('errors.storage.googleFileIdInvalid'));
    await this.#call('google.delete', { fileId: id }, signal);
  }
  async allocateFileId({ signal } = {}) {
    const result = await this.#call('google.allocate', {}, signal);
    requireValue(Array.isArray(result.ids) && result.ids.length === 1 && validFileId(result.ids[0]), 'invalid-source-file', t('errors.storage.googleFileIdInvalid')); return result.ids[0];
  }
  async readFile({ file, signal }) {
    file = validateFile(file); signal?.throwIfAborted();
    const bytes = await this.#transfers.download('google.read', { accountId: this.#account, file }, Math.max(file.size, 65536));
    signal?.throwIfAborted(); return verifyFile(file, bytes);
  }
  async createFile({ file, bytes, signal }) {
    file = validateFile(file); bytes = await verifyFile(file, bytes);
    const token = await this.#transfers.upload('attachment', bytes, signal);
    try {
      const result = googleDescriptor(await this.#call('google.create', { file, token }, signal));
      requireValue(JSON.stringify(result) === JSON.stringify(file), 'upload-mismatch', t('errors.storage.googleUploadMismatch')); return result;
    } finally { await this.#transfers.discard(token); }
  }
}
