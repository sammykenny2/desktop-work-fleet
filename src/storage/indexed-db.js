import { copy, FleetError, requireValue, safeKey } from '../core/contracts.js';

/** Browser/WebView adapter. Native hosts may supply the same account-scoped persistence contract. */
export class IndexedDbStorage {
  #db;
  constructor(db) { this.#db = db; }

  static open(name = 'work-fleet-v1') {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('workspaces', { keyPath: 'profileId' });
        db.createObjectStore('attachments', { keyPath: ['profileId', 'id'] });
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
    state = copy(state);
    requireValue(safeKey(state.profileId) && Number.isInteger(state.revision) && state.revision >= 0,
      'invalid-workspace', '本機資料身分或版本無效。');
    return this.#transaction(['workspaces'], 'readwrite', (tx, context) => {
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
        store.put(state);
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
