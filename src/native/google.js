import { FleetError, requireValue } from '../core/contracts.js';
import { NativeTransfers } from '../storage/native.js';
import { googleDescriptor } from '../sources/google-drive.js';
import { validateFile, verifyFile, validFileId } from '../sources/files.js';

const cursor = value => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192, 'invalid-source-page', 'Google 同步游標無效。'); return value;
};
const page = value => { requireValue(Array.isArray(value) && value.length <= 1000, 'invalid-source-page', 'Google 分頁無效。'); return value; };

/** Semantic FileStore only: credentials, URLs and HTTP authorization remain in the native service. */
export class NativeGoogleFileStore {
  #bridge; #account; #transfers;
  constructor(bridge, info, accountId) {
    requireValue(/^[A-Za-z0-9_-]{1,255}$/.test(accountId) && info.profileId === `google:${accountId}`, 'invalid-source', '需要目前工作空間的 Google 帳號。');
    this.#bridge = bridge; this.#account = accountId; this.#transfers = new NativeTransfers(bridge, info);
  }
  get sourceId() { return `google-drive:${this.#account}:appdata-v1`; }
  async #call(method, args, signal) {
    if (signal?.aborted) throw new FleetError('stale-session', 'Google 工作階段已結束。');
    const result = await this.#bridge.request(method, { accountId: this.#account, ...args });
    if (signal?.aborted) throw new FleetError('stale-session', 'Google 工作階段已結束。');
    return result;
  }
  async getStartCursor({ signal } = {}) { return cursor((await this.#call('google.cursor', {}, signal)).startPageToken); }
  async listFiles({ pageToken = null, signal } = {}) {
    const result = await this.#call('google.list', { pageToken: pageToken === null ? null : cursor(pageToken) }, signal);
    requireValue(result.incompleteSearch === undefined || typeof result.incompleteSearch === 'boolean', 'invalid-source-page', 'Google 列舉狀態無效。');
    return { files: page(result.files || []).map(googleDescriptor), incomplete: result.incompleteSearch === true,
      nextPageToken: result.nextPageToken === undefined ? null : cursor(result.nextPageToken) };
  }
  async listChanges({ cursor: current, signal }) {
    const result = await this.#call('google.changes', { cursor: cursor(current) }, signal);
    requireValue(!(result.nextPageToken !== undefined && result.newStartPageToken !== undefined), 'invalid-source-page', 'Google 分頁終點無效。');
    const changes = page(result.changes || []).map(change => {
      requireValue(validFileId(change?.fileId) && (change.removed === undefined || typeof change.removed === 'boolean'), 'invalid-source-page', 'Google 變更格式無效。');
      if (change.removed || change.file?.trashed) return { id: change.fileId, removed: true };
      const file = googleDescriptor(change.file);
      requireValue(file.id === change.fileId, 'invalid-source-page', 'Google 檔案身分不符。'); return { id: change.fileId, removed: false, file };
    });
    return { changes, ...(result.nextPageToken === undefined ? { cursor: cursor(result.newStartPageToken) } : { nextCursor: cursor(result.nextPageToken) }) };
  }
  // Ids only, so a reset can delete files this version cannot read.
  async listFileIds({ pageToken = null, signal } = {}) {
    const result = await this.#call('google.list', { pageToken: pageToken === null ? null : cursor(pageToken) }, signal);
    return { ids: page(result.files || []).map(file => { requireValue(validFileId(file?.id), 'invalid-source-page', 'Google 檔案身分無效。'); return file.id; }),
      nextPageToken: result.nextPageToken === undefined ? null : cursor(result.nextPageToken) };
  }
  async deleteFile({ id, signal }) {
    requireValue(validFileId(id), 'invalid-source-file', 'Google 檔案身分無效。');
    await this.#call('google.delete', { fileId: id }, signal);
  }
  async allocateFileId({ signal } = {}) {
    const result = await this.#call('google.allocate', {}, signal);
    requireValue(Array.isArray(result.ids) && result.ids.length === 1 && validFileId(result.ids[0]), 'invalid-source-file', 'Google 檔案身分無效。'); return result.ids[0];
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
      requireValue(JSON.stringify(result) === JSON.stringify(file), 'upload-mismatch', 'Google 上傳結果與內容不同。'); return result;
    } finally { await this.#transfers.discard(token); }
  }
}
