import { FleetError, requireValue } from '../core/contracts.js';
import { NativeTransfers } from '../storage/native.js';
import { driveFolder, googleDescriptor } from '../sources/google-drive.js';
import { validateFile, verifyFile, validFileId } from '../sources/files.js';
import { t } from '../i18n/index.js';
import { canonicalJson } from '../sources/json.js';
import { DATASET_FORMAT, datasetQuery, googleDatasetDescriptor, googleDatasetOwned, validateDatasetFile, verifyDatasetBytes } from '../sources/dataset-codec.js';

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

/** Dataset operations remain semantic RPCs. Neither query strings nor HTTP/upload addresses cross this bridge. */
export class NativeGoogleDatasetStore extends NativeGoogleFileStore {
  #bridge; #account; #transfers;
  constructor(bridge, info, accountId) {
    super(bridge, info, accountId); this.#bridge = bridge; this.#account = accountId; this.#transfers = new NativeTransfers(bridge, info);
  }
  async #call(method, args, signal) {
    signal?.throwIfAborted(); const result = await this.#bridge.request(`google.dataset.${method}`, { accountId: this.#account, ...args });
    signal?.throwIfAborted(); return result;
  }
  async listObjects({ query, pageToken = null, signal }) {
    datasetQuery(query);
    const result = await this.#call('list', { query, pageToken: pageToken === null ? null : cursor(pageToken) }, signal);
    requireValue(result.incompleteSearch === undefined || typeof result.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.storage.googleListingStateInvalid'));
    return { files: page(result.files ?? []).map(file => {
      if (query.scope === 'entity-data') return googleDatasetOwned(file, query);
      if (['legacy', 'fences'].includes(query.scope)) {
        requireValue(validFileId(file.id), 'invalid-source-page', t('errors.storage.googleFileIdInvalid'));
        requireValue(query.scope !== 'legacy' || typeof file.mimeType === 'string', 'invalid-source-page', t('errors.storage.googleListingStateInvalid'));
        return { id: file.id, kind: file.appProperties?.wfKind ?? null,
          ...(query.scope === 'legacy' ? { folder: file.mimeType === 'application/vnd.google-apps.folder' } : {}) };
      }
      return googleDatasetDescriptor(file, { rootParentVerified: query.scope === 'roots' });
    }), incomplete: result.incompleteSearch === true, nextPageToken: result.nextPageToken === undefined ? null : cursor(result.nextPageToken) };
  }
  async #descriptor(metadata, signal) {
    if (metadata.appProperties?.wfKind !== 'dataset-root' || metadata.parents?.[0] === 'appDataFolder') return googleDatasetDescriptor(metadata);
    const expected = googleDatasetDescriptor(metadata, { rootParentVerified: true });
    let pageToken = null; const seen = new Set();
    do {
      const result = await this.listObjects({ query: { scope: 'roots', datasetId: expected.datasetId }, pageToken, signal });
      requireValue(!result.incomplete, 'invalid-source-page', t('errors.sources.scanIncomplete'));
      if (result.files.some(file => canonicalJson(file) === canonicalJson(expected))) return expected;
      pageToken = result.nextPageToken;
      requireValue(!pageToken || !seen.has(pageToken) && seen.size < 2, 'invalid-dataset', t('errors.sources.datasetInvalid'));
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    throw new FleetError('invalid-dataset', t('errors.sources.datasetInvalid'));
  }
  async getObject({ id, signal }) {
    requireValue(validFileId(id), 'invalid-source-file', t('errors.storage.googleFileIdInvalid'));
    const file = await this.#descriptor(await this.#call('get', { fileId: id }, signal), signal);
    requireValue(file.id === id, 'file-integrity', t('errors.sources.fileIntegrity')); return file;
  }
  async readObject({ file, signal }) {
    file = validateDatasetFile(file); signal?.throwIfAborted();
    requireValue(Number.isSafeInteger(file.size), 'invalid-dataset', t('errors.sources.datasetInvalid'));
    const bytes = await this.#transfers.download('google.dataset.read', { accountId: this.#account, file }, Math.max(file.size, 65536));
    signal?.throwIfAborted(); return verifyDatasetBytes(file, bytes);
  }
  async createObject({ file, bytes, signal }) {
    file = validateDatasetFile(file); bytes = await verifyDatasetBytes(file, bytes);
    const token = await this.#transfers.upload('attachment', bytes, signal);
    try {
      const result = await this.#descriptor(await this.#call('create', { file, token }, signal), signal);
      requireValue(canonicalJson(result) === canonicalJson(file), 'upload-mismatch', t('errors.storage.googleUploadMismatch')); return result;
    } finally { await this.#transfers.discard(token); }
  }
  async createFolder({ file, signal }) {
    file = validateDatasetFile(file);
    requireValue(['folder', 'dataset-root'].includes(file.kind), 'invalid-dataset', t('errors.sources.datasetInvalid'));
    const result = await this.#descriptor(await this.#call('folder', { file }, signal), signal);
    requireValue(canonicalJson(result) === canonicalJson(file), 'upload-mismatch', t('errors.storage.googleUploadMismatch')); return result;
  }
  async listDatasetChanges({ cursor: current, signal }) {
    const result = await this.#call('changes', { cursor: cursor(current) }, signal);
    requireValue(!(result.nextPageToken !== undefined && result.newStartPageToken !== undefined), 'invalid-source-page', t('errors.storage.googlePageEndInvalid'));
    const changes = await Promise.all(page(result.changes ?? []).map(async change => {
      requireValue(validFileId(change?.fileId) && (change.removed === undefined || typeof change.removed === 'boolean'), 'invalid-source-page', t('errors.storage.googleChangeInvalid'));
      if (change.removed || change.file?.trashed) return { id: change.fileId, removed: true };
      if (change.file?.appProperties?.wfFormat !== DATASET_FORMAT) return { id: change.fileId, removed: false, legacyReset: change.file?.appProperties?.wfKind === 'reset' };
      const properties = change.file.appProperties;
      const file = ['revision', 'attachment'].includes(properties.wfKind) && !change.file.parents?.length
        ? googleDatasetOwned(change.file, { datasetId: properties.wfDataset, entities: [properties.wfEntity] })
        : await this.#descriptor(change.file, signal);
      requireValue(file.id === change.fileId, 'invalid-source-page', t('errors.storage.googleFileMismatch'));
      return { id: file.id, removed: false, file };
    }));
    return { changes, ...(result.nextPageToken === undefined ? { cursor: cursor(result.newStartPageToken) } : { nextCursor: cursor(result.nextPageToken) }) };
  }
}
