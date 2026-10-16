import { copy, FleetError, requireValue, safeKey } from '../core/contracts.js';
import { sha256, validDigest } from '../sources/files.js';
import { validateMigration } from '../core/schema.js';

/** Browser/WebView adapter. Native hosts may supply the same account-scoped persistence contract. */
export class IndexedDbStorage {
  #db;
  constructor(db) { this.#db = db; }

  static open(name = 'work-fleet-v1') {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 2);
      let failed = false;
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 1) {
          db.createObjectStore('workspaces', { keyPath: 'profileId' });
          db.createObjectStore('attachments', { keyPath: ['profileId', 'id'] });
        }
        if (event.oldVersion < 2) db.createObjectStore('migrations', { keyPath: ['profileId', 'fromVersion'] });
      };
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => {
        failed = true; reject(new FleetError('storage-blocked', '另一個視窗正在使用舊資料版本，請關閉後重試。'));
      };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(new IndexedDbStorage(request.result));
      };
    });
  }

  close() { this.#db.close(); }

  #transaction(stores, mode, work) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = this.#db.transaction(stores, mode, { durability: 'strict' }); }
      catch (error) { reject(error); return; }
      let result; let failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || new FleetError('storage-aborted', '本機保存已中止。'));
      const context = {
        result: value => { result = value; },
        fail: error => { failure = error; tx.abort(); },
      };
      try { work(tx, context); } catch (error) { context.fail(error); }
    });
  }

  load(profileId) {
    requireValue(safeKey(profileId), 'invalid-profile', '無效的帳號分區。');
    return this.#transaction(['workspaces'], 'readonly', (tx, context) => {
      const request = tx.objectStore('workspaces').get(profileId);
      request.onsuccess = () => context.result(request.result ?? null);
    });
  }

  save(state, expectedRevision) {
    return this.#save(state, expectedRevision, []);
  }

  migrate(state, expectedRevision, fromVersion) { return this.#save(state, expectedRevision, [], false, fromVersion); }

  recovery(profileId, fromVersion) {
    requireValue(safeKey(profileId) && Number.isSafeInteger(fromVersion) && fromVersion >= 1, 'invalid-migration', '資料升級版本無效。');
    return this.#transaction(['migrations'], 'readonly', (tx, context) => {
      const request = tx.objectStore('migrations').get([profileId, fromVersion]);
      request.onsuccess = () => context.result(request.result?.state ?? null);
    });
  }

  /** Deletes this profile's workspace and attachments in one transaction. */
  reset(profileId) {
    requireValue(safeKey(profileId), 'invalid-profile', '無效的帳號分區。');
    return this.#transaction(['workspaces', 'attachments', 'migrations'], 'readwrite', tx => {
      tx.objectStore('workspaces').delete(profileId);
      // [profileId] sorts before every [profileId, id] and [profileId, []] after every string id.
      tx.objectStore('attachments').delete(IDBKeyRange.bound([profileId], [profileId, []]));
      tx.objectStore('migrations').delete(IDBKeyRange.bound([profileId], [profileId, []]));
    });
  }

  async saveWithAttachments(state, expectedRevision, attachments, { replaceAttachments = false } = {}) {
    state = copy(state);
    requireValue(typeof replaceAttachments === 'boolean' && (!replaceAttachments || !state.profileId.startsWith('google:')),
      'invalid-request', '只有本機工作空間可以清空附件後還原。');
    requireValue(Array.isArray(attachments), 'invalid-attachment', '需要完整附件清單。');
    attachments = attachments.map(item => {
      requireValue(item && item.bytes instanceof Uint8Array, 'invalid-attachment', '需要完整附件 bytes。');
      return { id: item.id, bytes: new Uint8Array(item.bytes) };
    });
    const seen = new Set(); const values = [];
    for (const { id, bytes } of attachments) {
      requireValue(validDigest(id) && !seen.has(id) && bytes.length <= 25 * 1024 * 1024,
        'invalid-attachment', '附件身分或容量無效。'); seen.add(id);
      requireValue(await sha256(bytes) === id, 'attachment-integrity', '附件校驗失敗，尚未還原。');
      values.push({ profileId: state.profileId, id, blob: new Blob([bytes], { type: 'application/octet-stream' }) });
    }
    return this.#save(state, expectedRevision, values, replaceAttachments);
  }

  #save(state, expectedRevision, attachments, replaceAttachments = false, migrationFrom) {
    state = copy(state);
    requireValue(safeKey(state.profileId) && Number.isInteger(state.revision) && state.revision >= 0,
      'invalid-workspace', '本機資料身分或版本無效。');
    const stores = ['workspaces'];
    if (attachments.length || replaceAttachments) stores.push('attachments');
    if (migrationFrom !== undefined || replaceAttachments) stores.push('migrations');
    return this.#transaction(stores, 'readwrite', (tx, context) => {
      const store = tx.objectStore('workspaces');
      const request = store.get(state.profileId);
      request.onsuccess = () => {
        const current = request.result;
        if ((current?.revision ?? null) !== expectedRevision) {
          context.fail(new FleetError('stale-writer', '資料已在另一個視窗變更；保留草稿，重新載入後再保存。'));
          return;
        }
        if (state.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
          context.fail(new FleetError('invalid-revision', '本機保存版本不連續。')); return;
        }
        try {
          if (migrationFrom !== undefined) {
            validateMigration(current, state, migrationFrom);
            requireValue(!attachments.length && !replaceAttachments, 'invalid-migration', '資料升級不可同時取代附件。');
            tx.objectStore('migrations').add({ profileId: state.profileId, fromVersion: migrationFrom, state: current });
          } else requireValue(!current || current.schemaVersion === state.schemaVersion, 'migration-required', '資料升級需要安全保存原始副本。');
          store.put(state);
          if (replaceAttachments) {
            tx.objectStore('attachments').delete(IDBKeyRange.bound([state.profileId], [state.profileId, []]));
            tx.objectStore('migrations').delete(IDBKeyRange.bound([state.profileId], [state.profileId, []]));
          }
        } catch (error) { context.fail(error); return; }
        if (attachments.length) for (const attachment of attachments) tx.objectStore('attachments').put(attachment);
      };
    });
  }

  async putAttachment(profileId, file) {
    requireValue(safeKey(profileId) && file instanceof Blob, 'invalid-attachment', '附件格式無效。');
    requireValue(file.size <= 25 * 1024 * 1024, 'attachment-size', '每個附件上限為 25 MiB。');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const id = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const metadata = { id, name: file.name || 'attachment', mediaType: file.type || 'application/octet-stream', size: file.size };
    await this.#transaction(['attachments'], 'readwrite', tx => {
      tx.objectStore('attachments').put({ profileId, id, blob: file });
    });
    return metadata;
  }

  getAttachment(profileId, id) {
    requireValue(safeKey(profileId) && safeKey(id), 'invalid-attachment', '附件身分無效。');
    return this.#transaction(['attachments'], 'readonly', (tx, context) => {
      const request = tx.objectStore('attachments').get([profileId, id]);
      request.onsuccess = () => context.result(request.result?.blob ?? null);
    });
  }

  async putAttachmentBytes(profileId, id, bytes) {
    requireValue(safeKey(profileId) && validDigest(id) && bytes instanceof Uint8Array && bytes.byteLength <= 25 * 1024 * 1024,
      'invalid-attachment', '附件身分或容量無效。');
    bytes = copy(bytes);
    requireValue(await sha256(bytes) === id, 'attachment-integrity', '附件內容與校驗值不符。');
    await this.#transaction(['attachments'], 'readwrite', tx => {
      tx.objectStore('attachments').put({ profileId, id, blob: new Blob([bytes], { type: 'application/octet-stream' }) });
    });
  }
}

export async function acquireProfile(profileId) {
  requireValue(navigator.locks, 'storage-lock-unavailable', '此瀏覽器不支援安全的單一寫入者鎖，請使用原生 App 或新版瀏覽器。');
  let release; let announce;
  const available = new Promise(resolve => { announce = resolve; });
  const lifetime = new Promise(resolve => { release = resolve; });
  const held = navigator.locks.request(`work-fleet:${profileId}`, { ifAvailable: true }, async lock => {
    announce(Boolean(lock));
    if (lock) await lifetime;
  });
  held.catch(() => announce(false));
  const acquired = await available;
  return { acquired, release, closed: held };
}
