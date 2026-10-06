import { copy, FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { decodeRevision, encodeRevision, revisionRecord } from './revisions.js';
import { sha256, validDigest, validFileId, validateFile, verifyFile } from './files.js';

const cursorValue = value => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192, 'invalid-source-page', '來源未提供有效的同步游標。');
  return value;
};
const pageArray = value => requireValue(Array.isArray(value) && value.length <= 1000, 'invalid-source-page', '來源分頁格式或容量無效。');
const sourceReset = () => new FleetError('source-reset', '這個帳號的雲端資料已在其他裝置重設；這台裝置的副本仍保留，同步已暫停。');
const retryable = code => ['network', 'rate-limit', 'service-unavailable'].includes(code);

/**
 * Clears an account's source. The reset marker is written first, so a device that still holds the old files reads
 * the deletions that follow as a reset instead of as missing files. Deleting is repeated until only the marker is
 * left, which also removes files another device uploaded before it noticed the marker.
 */
export async function resetSource(store, { progress = () => {}, now = () => Date.now(), wait = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const attempt = async action => {
    for (let failures = 0; ; failures++) {
      try { return await action(); }
      catch (error) { if (!retryable(error.code) || failures >= 5) throw error; await wait(1000 * 2 ** failures); }
    }
  };
  const bytes = new TextEncoder().encode(canonicalJson({ format: 'work-fleet-reset', schema: 1, resetAt: new Date(now()).toISOString() }));
  const marker = validateFile({ id: await attempt(() => store.allocateFileId({})), kind: 'reset', sha256: await sha256(bytes), size: bytes.byteLength });
  await attempt(() => store.createFile({ file: marker, bytes }));
  let deleted = 0;
  for (let pass = 0; pass < 5; pass++) {
    const ids = []; const tokens = new Set(); let pageToken = null;
    do {
      const page = await attempt(() => store.listFileIds({ pageToken })); pageArray(page.ids);
      ids.push(...page.ids.filter(id => id !== marker.id));
      pageToken = page.nextPageToken ?? null;
      if (pageToken !== null) {
        cursorValue(pageToken);
        requireValue(!tokens.has(pageToken), 'source-page-loop', '來源重複回傳相同分頁，已停止重設。'); tokens.add(pageToken);
      }
    } while (pageToken !== null);
    if (!ids.length) return { marker, deleted };
    for (const [index, id] of ids.entries()) { await attempt(() => store.deleteFile({ id })); deleted++; progress(deleted, deleted + ids.length - index - 1); }
  }
  throw new FleetError('source-reset-incomplete', '雲端仍不斷出現新檔案，重設尚未完成；請確認其他裝置已停止同步後重試。');
}

/** Account-bound FileStore coordinator. FileStore owns authorization; no credential enters Workspace. */
export class FileSync {
  #workspace;
  #storage;
  #store;
  #session = null;
  #abort = new AbortController();
  #closed = false;
  #running = null;
  #now;
  #random;
  #failures = 0;
  #status = { phase: 'idle', pending: 0, nextAttemptAt: 0, error: null };

  constructor({ workspace, storage, fileStore, now = () => Date.now(), random = Math.random }) {
    requireValue(typeof fileStore.sourceId === 'string' && fileStore.sourceId.length > 0, 'invalid-source', '檔案來源需要穩定的帳號身分。');
    this.#workspace = workspace; this.#storage = storage; this.#store = fileStore; this.#now = now; this.#random = random;
  }

  get status() { return copy(this.#status); }

  #check() {
    requireValue(!this.#closed && this.#session?.sourceId === this.#store.sourceId, 'stale-session', '此來源工作已結束，舊回應未套用。');
    this.#workspace.assertSyncSession(this.#session);
  }

  async #request(method, input = {}) {
    this.#check();
    const result = await this.#store[method]({ ...input, signal: this.#abort.signal });
    this.#check(); return result;
  }

  sync({ force = false } = {}) {
    if (this.#running) return this.#running;
    if (this.#closed) return Promise.reject(new FleetError('stale-session', '此來源工作已結束。'));
    if (!force && this.#now() < this.#status.nextAttemptAt) {
      return Promise.reject(new FleetError('sync-backoff', '正在等待來源重試時間。', { retryAt: this.#status.nextAttemptAt }));
    }
    this.#running = this.#run().finally(() => { this.#running = null; });
    return this.#running;
  }

  async stop() {
    this.#closed = true; this.#abort.abort();
    if (this.#session) {
      try { await this.#workspace.endSync(this.#session); }
      catch (error) { if (error.code !== 'stale-session') throw error; }
    }
    this.#status = { ...this.#status, phase: 'stopped' };
  }

  async #run() {
    this.#status = { phase: 'syncing', pending: this.#workspace.pendingOperations.length, nextAttemptAt: 0, error: null };
    try {
      if (!this.#session) {
        this.#session = await this.#workspace.beginSync(this.#store.sourceId);
        if (this.#closed) { await this.#workspace.endSync(this.#session); throw new FleetError('stale-session', '此來源工作已結束。'); }
      }
      this.#check(); await this.#pull(); await this.#push(); await this.#pull();
      this.#check();
      this.#failures = 0;
      this.#status = { phase: 'idle', pending: this.#workspace.pendingOperations.length, nextAttemptAt: 0, error: null };
      return this.status;
    } catch (error) {
      const retryable = ['network', 'rate-limit', 'service-unavailable', 'page-expired', 'upload-session-expired'].includes(error.code);
      const delay = retryable ? Math.max(Math.min(60000, 1000 * 2 ** Math.min(this.#failures++, 6))
        * (0.5 + this.#random() * 0.5), Number.isFinite(error.details?.retryAfterMs) ? error.details.retryAfterMs : 0) : 0;
      this.#status = { phase: this.#closed ? 'stopped' : error.code === 'unauthorized' ? 'needs-login' : retryable ? 'backoff' : 'needs-attention',
        pending: this.#workspace.pendingOperations.length, nextAttemptAt: retryable ? this.#now() + delay : 0,
        error: { code: error.code || 'storage-error', message: error.message } };
      throw error;
    }
  }

  async #receive(files, expectedCursor, cursor) {
    pageArray(files); files = files.map(validateFile).filter(file => file.kind !== 'reset');
    const records = [];
    for (const file of files) {
      const bytes = await verifyFile(file, await this.#request('readFile', { file }));
      this.#check();
      if (file.kind === 'revision') records.push(decodeRevision(bytes));
      else await this.#storage.putAttachmentBytes(this.#session.profileId, file.sha256, bytes);
    }
    this.#check();
    if (files.length || cursor !== expectedCursor) {
      await this.#workspace.receiveRevisions(records, { session: this.#session, expectedCursor, cursor, files });
    }
  }

  async #fullScan() {
    const baseline = cursorValue(await this.#request('getStartCursor'));
    let pageToken = null; const tokens = new Set(); const found = new Set(); let marked = false;
    do {
      const page = await this.#request('listFiles', { pageToken }); pageArray(page.files);
      requireValue(!page.incomplete, 'incomplete-source-scan', '來源尚未完成全部檔案列舉，游標未前進。');
      marked ||= page.files.some(file => file?.kind === 'reset');
      await this.#receive(page.files, null, null);
      for (const file of page.files) found.add(file.id);
      pageToken = page.nextPageToken ?? null;
      if (pageToken !== null) {
        cursorValue(pageToken);
        requireValue(!tokens.has(pageToken), 'source-page-loop', '來源重複回傳相同分頁，已停止同步。'); tokens.add(pageToken);
      }
    } while (pageToken !== null);
    for (const file of Object.values(this.#workspace.syncState.files || {})) {
      // Known files gone next to a reset marker were cleared on purpose; without one their absence stays an error.
      if (!found.has(file.id) && marked) throw sourceReset();
      requireValue(found.has(file.id), 'source-file-missing', '原有同步檔案已不在來源中；本機內容保留，不能由檔案缺席推論刪除。');
    }
    this.#check(); await this.#workspace.receiveRevisions([], { session: this.#session, expectedCursor: null, cursor: baseline });
  }

  async #pull() {
    if (this.#workspace.syncState.cursor === null) await this.#fullScan();
    let restarted = false; const tokens = new Set();
    while (true) {
      const cursor = this.#workspace.syncState.cursor;
      let page;
      try { page = await this.#request('listChanges', { cursor }); }
      catch (error) {
        if (error.code !== 'cursor-expired' || restarted) throw error;
        this.#check();
        await this.#workspace.receiveRevisions([], { session: this.#session, expectedCursor: cursor, cursor: null });
        await this.#fullScan(); restarted = true; tokens.clear(); continue;
      }
      pageArray(page.changes);
      const known = new Set(Object.values(this.#workspace.syncState.files || {}).map(file => file.id));
      const files = []; let removedKnown = false;
      for (const change of page.changes) {
        requireValue(change && validFileId(change.id) && typeof change.removed === 'boolean', 'invalid-source-page', '來源變更記錄無效。');
        // A file this device never received leaves nothing behind when it goes; a known one going needs the user.
        if (change.removed) { removedKnown ||= known.has(change.id); continue; }
        requireValue(change.file?.id === change.id, 'invalid-source-page', '來源變更與檔案身分不符。');
        files.push(validateFile(change.file));
      }
      // A reset writes its marker before deleting, so the marker reaches this device ahead of the removals.
      if (files.some(file => file.kind === 'reset') && known.size) throw sourceReset();
      requireValue(!removedKnown, 'source-file-missing', '來源檔案已被移除；本機內容保留，請處理同步來源。');
      const next = page.nextCursor ?? null;
      requireValue(next === null || page.cursor == null, 'invalid-source-page', '來源混用了中間及完成游標。');
      const target = cursorValue(next ?? page.cursor);
      if (next !== null) {
        requireValue(target !== cursor && !tokens.has(target), 'source-page-loop', '來源重複回傳相同分頁，已停止同步。'); tokens.add(target);
      }
      await this.#receive(files, cursor, target);
      if (next === null) return;
    }
  }

  async #upload(kind, key, bytes) {
    this.#check(); const operation = `${kind}:${key}`;
    let upload = this.#workspace.uploadState(this.#session, operation);
    if (upload?.complete) return;
    const digest = await sha256(bytes); this.#check();
    if (!upload) {
      const id = await this.#request('allocateFileId');
      upload = await this.#workspace.reserveUpload(this.#session, key, { id, kind, sha256: digest, size: bytes.byteLength });
    }
    requireValue(upload.file.sha256 === digest && upload.file.size === bytes.byteLength, 'upload-mismatch', '重試的檔案與已保存操作不符。');
    this.#check();
    try {
      const result = validateFile(await this.#request('createFile', { file: upload.file, bytes }));
      requireValue(canonicalJson(result) === canonicalJson(upload.file), 'upload-mismatch', '上傳回應與已保存的檔案身分不符。');
    } catch (error) {
      if (error.code !== 'file-exists') throw error;
      const remote = await verifyFile(upload.file, await this.#request('readFile', { file: upload.file }));
      requireValue(remote.length === bytes.length && remote.every((byte, index) => byte === bytes[index]),
        'upload-mismatch', '已存在的來源檔案內容不同，待送資料仍保留。');
    }
    this.#check(); await this.#workspace.completeUpload(this.#session, operation, upload.file.id);
  }

  async #push() {
    for (const operation of this.#workspace.pendingOperations) {
      this.#check();
      for (const attachment of operation.value.content?.attachments || []) {
        requireValue(validDigest(attachment.id), 'attachment-address', '此附件需要有效的 SHA-256 内容身分才能同步。');
        if (this.#workspace.uploadState(this.#session, `attachment:${attachment.id}`)?.complete) continue;
        const blob = await this.#storage.getAttachment(this.#session.profileId, attachment.id); this.#check();
        requireValue(blob instanceof Blob, 'missing-attachment', '附件尚未收到，引用它的版本仍保留在待送清單。');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        requireValue(await sha256(bytes) === attachment.id, 'attachment-integrity', '本機附件內容與身分不符，尚未上傳。');
        await this.#upload('attachment', attachment.id, bytes);
      }
      await this.#upload('revision', operation.operationId, encodeRevision(revisionRecord(operation.kind, operation.value, operation.parents)));
    }
  }
}
