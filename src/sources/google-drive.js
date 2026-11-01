import { FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { validFileId, validateFile, verifyFile } from './files.js';
import { schemas } from '../core/schema.js';
import { t } from '../i18n/index.js';
import { DATASET_FIELDS, DATASET_FORMAT, datasetMetadata, datasetQuery, googleDatasetDescriptor, googleDatasetOwned,
  validateDatasetFile, verifyDatasetBytes } from './dataset-codec.js';

const FIELDS = 'id,size,spaces,trashed,appProperties,sha256Checksum';
const JSON_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const encode = value => new TextEncoder().encode(value);
const token = value => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192,
    'invalid-source-page', t('errors.sources.driveCursorInvalid')); return value;
};
const pathFor = (path, query) => `${path}?${new URLSearchParams(query)}`;
const header = (response, name) => new Headers(response.headers).get(name);
const items = value => {
  requireValue(value === undefined || (Array.isArray(value) && value.length <= 1000),
    'invalid-source-page', t('errors.sources.drivePageInvalid')); return value || [];
};

export function googleDescriptor(value) {
  const properties = value?.appProperties;
  requireValue(value && (value.trashed === undefined || value.trashed === false)
    && Array.isArray(value.spaces) && value.spaces.includes('appDataFolder')
    && properties?.wfFormat === 'work-fleet-file' && properties.wfSchema === String(schemas.driveFile)
    && typeof value.size === 'string' && /^(0|[1-9][0-9]*)$/.test(value.size),
  'unsupported-source-file', t('errors.sources.driveFileUnsupported'));
  const file = validateFile({ id: value.id, kind: properties.wfKind, sha256: properties.wfSha256, size: Number(value.size) });
  requireValue(value.sha256Checksum === undefined || value.sha256Checksum === file.sha256,
    'file-integrity', t('errors.sources.driveChecksumMismatch'));
  return file;
}
const descriptor = googleDescriptor;
// The app data folder itself shows up in the changes feed once Drive creates it, with the first upload; it holds the
// files and is none of them. The feed asks for mimeType so it can be told apart.
export const driveFolder = file => file?.mimeType === 'application/vnd.google-apps.folder';

// Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any distinct
// parameters are accepted; where the contents and the token go is what stays fixed.
function sessionPath(location) {
  let url;
  try { url = new URL(location); } catch { /* The validated error below omits the supplied URL. */ }
  const keys = url ? [...url.searchParams.keys()] : [];
  requireValue(url?.origin === 'https://www.googleapis.com' && url.pathname === '/upload/drive/v3/files'
    && !url.username && !url.password && !url.hash && url.searchParams.get('uploadType') === 'resumable'
    && new Set(keys).size === keys.length && url.searchParams.get('upload_id')?.length > 0 && location.length <= 8192,
  'invalid-upload-session', t('errors.sources.driveUploadSessionInvalid'));
  return url.pathname + url.search;
}

/** Trusted service adapter. request is account-bound native HTTP, never a renderer credential API. */
export class GoogleDriveFileStore {
  #request;
  #accountId;
  #now;
  #uploads = new Map();

  constructor({ accountId, request, now = () => Date.now() }) {
    requireValue(typeof accountId === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(accountId) && typeof request === 'function',
      'invalid-source', t('errors.sources.driveAccountRequired'));
    this.#accountId = accountId; this.#request = request; this.#now = now;
  }

  get sourceId() { return `google-drive:${this.#accountId}:appdata-v1`; }

  async #http({ path, method = 'GET', headers = {}, body, signal, maxResponseBytes = JSON_BYTES, allowed = [], context }) {
    requireValue(!signal?.aborted, 'stale-session', t('errors.sources.driveSessionEnded'));
    let response;
    try { response = await this.#request({ path, method, headers, body, signal, maxResponseBytes }); }
    catch (error) {
      if (signal?.aborted || error.code === 'stale-session') throw new FleetError('stale-session', t('errors.sources.driveSessionEnded'));
      if (error.code === 'unauthorized') throw new FleetError('unauthorized', t('errors.sources.driveUnauthorized'));
      if (error.code === 'response-size') throw new FleetError('response-size', t('errors.sources.driveResponseTooLarge'));
      throw new FleetError('network', t('errors.sources.driveNetwork'));
    }
    requireValue(!signal?.aborted, 'stale-session', t('errors.sources.driveSessionEnded'));
    requireValue(response && Number.isInteger(response.status) && response.body instanceof Uint8Array
      && response.body.length <= maxResponseBytes, 'invalid-source-response', t('errors.sources.driveResponseInvalid'));
    if ((response.status >= 200 && response.status < 300) || allowed.includes(response.status)) return response;
    let reason;
    try { reason = parseJson(response.body)?.error?.errors?.[0]?.reason; } catch { /* Do not expose remote error bodies. */ }
    const status = response.status;
    const retry = header(response, 'retry-after');
    const retryAfterMs = retry === null ? 0 : Math.max(0, Math.min(86400000,
      /^\d+$/.test(retry) ? Number(retry) * 1000 : (Date.parse(retry) - this.#now()) || 0));
    const code = status === 401 ? 'unauthorized'
      : status === 409 ? 'file-exists'
      : status === 429 || (status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) ? 'rate-limit'
      : status >= 500 ? 'service-unavailable'
      : context === 'changes' && status === 410 ? 'cursor-expired'
      : context === 'listing' && [400, 410].includes(status) ? 'page-expired'
      : status === 404 ? (context === 'upload' ? 'upload-session-expired' : 'source-file-missing')
      : reason === 'storageQuotaExceeded' ? 'storage-quota'
      : ['activeItemCreationLimitExceeded', 'numChildrenInNonRootLimitExceeded'].includes(reason) ? 'source-item-limit'
      : status === 403 ? 'source-permission' : 'source-error';
    const messages = {
      unauthorized: t('errors.sources.driveUnauthorized'), 'file-exists': t('errors.sources.driveFileExists'),
      'rate-limit': t('errors.sources.driveRateLimit'), 'service-unavailable': t('errors.sources.driveUnavailable'),
      'cursor-expired': t('errors.sources.driveCursorExpired'), 'page-expired': t('errors.sources.drivePageExpired'),
      'upload-session-expired': t('errors.sources.driveUploadExpired'),
      'source-file-missing': t('errors.sources.driveFileMissing'),
      'storage-quota': t('errors.sources.driveQuota'),
      'source-item-limit': t('errors.sources.driveItemLimit'),
      'source-permission': t('errors.sources.drivePermission'), 'source-error': t('errors.sources.driveError'),
    };
    throw new FleetError(code, messages[code], { status, retryAfterMs });
  }

  async #json(options) {
    const value = parseJson((await this.#http(options)).body);
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'invalid-source-response', t('errors.sources.driveResponseNotObject'));
    return value;
  }

  async getStartCursor({ signal } = {}) {
    return token((await this.#json({ path: pathFor('/drive/v3/changes/startPageToken', { fields: 'startPageToken' }), signal })).startPageToken);
  }

  async listObjects({ query, pageToken = null, signal }) {
    const parameters = { spaces: 'appDataFolder', q: datasetQuery(query), pageSize: '100',
      fields: `nextPageToken,incompleteSearch,files(${DATASET_FIELDS})` };
    if (query.scope === 'history') parameters.orderBy = 'createdTime desc';
    if (pageToken !== null) parameters.pageToken = token(pageToken);
    const page = await this.#json({ path: pathFor('/drive/v3/files', parameters), signal, context: 'listing' });
    requireValue(page.incompleteSearch === undefined || typeof page.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.sources.driveListingStateInvalid'));
    return { files: items(page.files).map(file => {
      if (query.scope === 'entity-data') return googleDatasetOwned(file, query);
      if (['legacy', 'fences'].includes(query.scope)) {
        requireValue(validFileId(file.id), 'invalid-source-page', t('errors.sources.driveFileIdInvalid'));
        requireValue(query.scope !== 'legacy' || typeof file.mimeType === 'string', 'invalid-source-page', t('errors.sources.driveListingStateInvalid'));
        return { id: file.id, kind: file.appProperties?.wfKind ?? null,
          ...(query.scope === 'legacy' ? { folder: file.mimeType === 'application/vnd.google-apps.folder' } : {}) };
      }
      return googleDatasetDescriptor(file, { rootParentVerified: query.scope === 'roots' });
    }), incomplete: page.incompleteSearch === true, nextPageToken: page.nextPageToken === undefined ? null : token(page.nextPageToken) };
  }
  async getObject({ id, signal }) {
    requireValue(validFileId(id), 'invalid-source-file', t('errors.sources.driveFileIdInvalid'));
    const file = await this.#datasetDescriptor(await this.#json({ path: pathFor(`/drive/v3/files/${id}`, { fields: DATASET_FIELDS }), signal }), signal);
    requireValue(file.id === id, 'file-integrity', t('errors.sources.fileIntegrity')); return file;
  }
  async #datasetDescriptor(metadata, signal) {
    if (metadata.appProperties?.wfKind !== 'dataset-root' || metadata.parents?.[0] === 'appDataFolder') return googleDatasetDescriptor(metadata);
    const expected = googleDatasetDescriptor(metadata, { rootParentVerified: true });
    let pageToken = null; const seen = new Set();
    do {
      const page = await this.listObjects({ query: { scope: 'roots', datasetId: expected.datasetId }, pageToken, signal });
      requireValue(!page.incomplete, 'invalid-source-page', t('errors.sources.scanIncomplete'));
      if (page.files.some(file => canonicalJson(file) === canonicalJson(expected))) return expected;
      pageToken = page.nextPageToken;
      requireValue(!pageToken || !seen.has(pageToken) && seen.size < 2, 'invalid-dataset', t('errors.sources.datasetInvalid'));
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    throw new FleetError('invalid-dataset', t('errors.sources.datasetInvalid'));
  }
  async listDatasetChanges({ cursor, signal }) {
    const page = await this.#json({ path: pathFor('/drive/v3/changes', { pageToken: token(cursor), spaces: 'appDataFolder',
      pageSize: '100', includeRemoved: 'true', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${DATASET_FIELDS}))` }), signal, context: 'changes' });
    requireValue(!(page.nextPageToken !== undefined && page.newStartPageToken !== undefined), 'invalid-source-page', t('errors.sources.driveChangesTwoEnds'));
    const changes = await Promise.all(items(page.changes).map(async change => {
      requireValue(validFileId(change?.fileId) && (change.removed === undefined || typeof change.removed === 'boolean'), 'invalid-source-page', t('errors.sources.driveChangeIdInvalid'));
      if (change.removed || change.file?.trashed) return { id: change.fileId, removed: true };
      if (change.file?.appProperties?.wfFormat !== DATASET_FORMAT) return { id: change.fileId, removed: false,
        legacyReset: change.file?.appProperties?.wfKind === 'reset' };
      const properties = change.file.appProperties;
      const file = ['revision', 'attachment'].includes(properties.wfKind) && !change.file.parents?.length
        ? googleDatasetOwned(change.file, { datasetId: properties.wfDataset, entities: [properties.wfEntity] })
        : await this.#datasetDescriptor(change.file, signal);
      requireValue(file.id === change.fileId, 'invalid-source-page', t('errors.sources.driveChangeFileMismatch'));
      return { id: file.id, removed: false, file };
    }));
    return { changes, ...(page.nextPageToken === undefined ? { cursor: token(page.newStartPageToken) } : { nextCursor: token(page.nextPageToken) }) };
  }
  async readObject({ file, signal }) {
    file = validateDatasetFile(file);
    requireValue(Number.isSafeInteger(file.size), 'invalid-dataset', t('errors.sources.datasetInvalid'));
    requireValue(canonicalJson(await this.getObject({ id: file.id, signal })) === canonicalJson(file), 'file-integrity', t('errors.sources.fileIntegrity'));
    const response = await this.#http({ path: pathFor(`/drive/v3/files/${file.id}`, { alt: 'media' }), signal, maxResponseBytes: Math.max(file.size, 65536) });
    return verifyDatasetBytes(file, response.body);
  }
  async createFolder({ file, signal }) {
    file = validateDatasetFile(file);
    requireValue(['folder', 'dataset-root'].includes(file.kind), 'invalid-dataset', t('errors.sources.datasetInvalid'));
    const value = await this.#datasetDescriptor(await this.#json({ path: pathFor('/drive/v3/files', { fields: DATASET_FIELDS }), method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: encode(canonicalJson(datasetMetadata(file))), signal }), signal);
    requireValue(canonicalJson(value) === canonicalJson(file), 'upload-mismatch', t('errors.sources.driveUploadMismatch')); return value;
  }
  async createObject({ file, bytes, signal }) {
    file = validateDatasetFile(file); bytes = await verifyDatasetBytes(file, bytes);
    return this.#create(file, bytes, datasetMetadata(file), signal, DATASET_FIELDS, googleDatasetDescriptor, value => this.readObject(value));
  }

  async listFiles({ pageToken = null, signal } = {}) {
    const query = { spaces: 'appDataFolder', q: 'trashed = false', pageSize: '100', fields: `nextPageToken,incompleteSearch,files(${FIELDS})` };
    if (pageToken !== null) query.pageToken = token(pageToken);
    const page = await this.#json({ path: pathFor('/drive/v3/files', query), signal, context: pageToken === null ? undefined : 'listing' });
    requireValue(page.incompleteSearch === undefined || typeof page.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.sources.driveListingStateInvalid'));
    return { files: items(page.files).map(descriptor), incomplete: page.incompleteSearch === true,
      nextPageToken: page.nextPageToken === undefined ? null : token(page.nextPageToken) };
  }

  // Ids only, so a reset can delete files this version cannot read.
  async listFileIds({ pageToken = null, signal } = {}) {
    const query = { spaces: 'appDataFolder', q: 'trashed = false', pageSize: '100', fields: 'nextPageToken,incompleteSearch,files(id,appProperties)' };
    if (pageToken !== null) query.pageToken = token(pageToken);
    const page = await this.#json({ path: pathFor('/drive/v3/files', query), signal, context: pageToken === null ? undefined : 'listing' });
    requireValue(page.incompleteSearch === undefined || typeof page.incompleteSearch === 'boolean', 'invalid-source-page', t('errors.sources.driveListingStateInvalid'));
    return { ids: items(page.files).map(file => { requireValue(validFileId(file?.id), 'invalid-source-page', t('errors.sources.driveFileIdInvalid')); return file.id; }),
      incomplete: page.incompleteSearch === true,
      resetIds: items(page.files).filter(file => file.appProperties?.wfKind === 'reset').map(file => file.id),
      nextPageToken: page.nextPageToken === undefined ? null : token(page.nextPageToken) };
  }

  async deleteFile({ id, signal }) {
    requireValue(validFileId(id), 'invalid-source-file', t('errors.sources.driveFileIdInvalid'));
    // A file that is already gone counts as deleted.
    await this.#http({ path: `/drive/v3/files/${id}`, method: 'DELETE', signal, allowed: [404] });
  }

  async listChanges({ cursor, signal }) {
    const page = await this.#json({ path: pathFor('/drive/v3/changes', { pageToken: token(cursor), spaces: 'appDataFolder',
      pageSize: '100', includeRemoved: 'true', fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS},mimeType))` }),
    signal, context: 'changes' });
    requireValue(!(page.nextPageToken !== undefined && page.newStartPageToken !== undefined),
      'invalid-source-page', t('errors.sources.driveChangesTwoEnds'));
    const changes = items(page.changes).map(change => {
      requireValue(change && validFileId(change.fileId) && (change.removed === undefined || typeof change.removed === 'boolean'),
        'invalid-source-page', t('errors.sources.driveChangeIdInvalid'));
      if (change.removed || change.file?.trashed) return { id: change.fileId, removed: true };
      if (driveFolder(change.file)) return null;
      const file = descriptor(change.file);
      requireValue(file.id === change.fileId, 'invalid-source-page', t('errors.sources.driveChangeFileMismatch'));
      return { id: change.fileId, removed: false, file };
    }).filter(Boolean);
    return { changes, ...(page.nextPageToken === undefined ? { cursor: token(page.newStartPageToken) }
      : { nextCursor: token(page.nextPageToken) }) };
  }

  async allocateFileId({ signal } = {}) {
    const value = await this.#json({ path: pathFor('/drive/v3/files/generateIds', { count: '1', space: 'appDataFolder', type: 'files', fields: 'ids' }), signal });
    requireValue(Array.isArray(value.ids) && value.ids.length === 1 && validFileId(value.ids[0]), 'invalid-source-file', t('errors.sources.driveFileIdMissing'));
    return value.ids[0];
  }

  async readFile({ file, signal }) {
    file = validateFile(file);
    const response = await this.#http({ path: pathFor(`/drive/v3/files/${file.id}`, { alt: 'media' }), signal,
      maxResponseBytes: Math.max(file.size, 64 * 1024) });
    return verifyFile(file, response.body);
  }

  async #uploaded(response, file, signal, convert, read) {
    const metadata = parseJson(response.body); const received = convert(metadata);
    requireValue(canonicalJson(received) === canonicalJson(file), 'upload-mismatch', t('errors.sources.driveUploadMismatch'));
    if (metadata.sha256Checksum === undefined) await read({ file, signal });
    this.#uploads.delete(file.id); return received;
  }

  #offset(response, max, previous = -1) {
    const range = header(response, 'range'); let offset = 0;
    if (range !== null) {
      const match = /^bytes=0-(0|[1-9][0-9]*)$/.exec(range);
      requireValue(match && Number.isSafeInteger(Number(match[1])), 'invalid-upload-range', t('errors.sources.driveUploadRangeInvalid'));
      offset = Number(match[1]) + 1;
    }
    requireValue(offset <= max, 'invalid-upload-range', t('errors.sources.driveUploadRangeAhead'));
    requireValue(offset > previous, 'service-unavailable', t('errors.sources.driveUploadStalled'));
    return offset;
  }

  async createFile({ file, bytes, signal }) {
    file = validateFile(file); bytes = await verifyFile(file, bytes);
    const metadata = { id: file.id, name: `work-fleet-v1-${file.kind}-${file.sha256}.${file.kind === 'revision' ? 'json' : 'bin'}`,
      mimeType: 'application/octet-stream', parents: ['appDataFolder'], appProperties: {
        wfFormat: 'work-fleet-file', wfSchema: String(schemas.driveFile), wfKind: file.kind, wfSha256: file.sha256,
      } };
    return this.#create(file, bytes, metadata, signal, FIELDS, descriptor, value => this.readFile(value));
  }

  async #create(file, bytes, metadata, signal, fields, convert, read) {
    const complete = response => this.#uploaded(response, file, signal, convert, read);
    if (file.size === 0) {
      // Multipart represents an empty attachment unambiguously, without an invalid 0--1 Content-Range.
      const boundary = `wf_${crypto.randomUUID()}`;
      const body = encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`
        + `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`);
      return complete(await this.#http({ path: pathFor('/upload/drive/v3/files', { uploadType: 'multipart', fields }),
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal }));
    }
    let session = this.#uploads.get(file.id); let offset = 0;
    try {
      if (session) {
        requireValue(canonicalJson(session.file) === canonicalJson(file), 'upload-mismatch', t('errors.sources.driveResumeMismatch'));
        const status = await this.#http({ path: session.path, method: 'PUT', headers: { 'Content-Range': `bytes */${file.size}` },
          body: new Uint8Array(), signal, allowed: [308], context: 'upload' });
        if (status.status !== 308) return await complete(status);
        offset = this.#offset(status, file.size);
      } else {
        const response = await this.#http({ path: pathFor('/upload/drive/v3/files', { uploadType: 'resumable', fields }), method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(file.size) }, body: encode(JSON.stringify(metadata)), signal });
        session = { path: sessionPath(header(response, 'location')), file };
        this.#uploads.set(file.id, session);
      }
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK_BYTES, file.size);
        const response = await this.#http({ path: session.path, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end - 1}/${file.size}` }, body: bytes.slice(offset, end), signal, allowed: [308], context: 'upload' });
        if (response.status !== 308) return await complete(response);
        offset = this.#offset(response, end, offset);
      }
      throw new FleetError('service-unavailable', t('errors.sources.driveUploadUnconfirmed'));
    } catch (error) {
      if ((error.details?.status >= 400 && error.details.status < 500)
        || ['file-exists', 'unauthorized', 'stale-session'].includes(error.code)) this.#uploads.delete(file.id);
      throw error;
    }
  }
}
