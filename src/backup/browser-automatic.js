import { copy, FleetError, requireValue, safeKey } from '../core/contracts.js';

/** Account-scoped policy/inventory; directory and file handles stay out of Workspace and portable backups. */
export class IndexedDbBackupJournal {
  #db;
  constructor(db) { this.#db = db; }
  static open(name = 'work-fleet-backups-v1') {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1); let failed = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore('journals', { keyPath: 'profileId' });
      };
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => { failed = true; reject(new FleetError('backup-journal-blocked', '另一視窗尚未關閉備份紀錄。')); };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close(); resolve(new IndexedDbBackupJournal(request.result));
      };
    });
  }
  close() { this.#db.close(); }
  #transaction(store, mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction([store], mode, { durability: 'strict' }); let value; let failure;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(failure || transaction.error || new FleetError('backup-journal-aborted', '備份紀錄保存中止。'));
      const context = { result: result => { value = result; }, fail: error => { failure = error; transaction.abort(); } };
      try { action(transaction.objectStore(store), context); } catch (error) { context.fail(error); }
    });
  }
  #get(store, key) {
    return this.#transaction(store, 'readonly', (objectStore, context) => {
      const request = objectStore.get(key); request.onsuccess = () => context.result(request.result || null);
    });
  }
  load(profileId) { requireValue(safeKey(profileId), 'backup-profile', '備份帳號無效。'); return this.#get('journals', profileId); }
  reset(profileId) {
    requireValue(safeKey(profileId), 'backup-profile', '備份帳號無效。');
    return this.#transaction('journals', 'readwrite', store => { store.delete(profileId); });
  }
  save(state, expectedRevision) {
    state = copy(state);
    return this.#transaction('journals', 'readwrite', (store, context) => {
      const request = store.get(state.profileId);
      request.onsuccess = () => {
        if ((request.result?.revision ?? null) !== expectedRevision || state.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
          context.fail(new FleetError('stale-backup-writer', '另一個工作已更新備份紀錄，尚未寫入檔案。')); return;
        }
        store.put(state);
      };
    });
  }
}

/** Browser handles are path locators. Automatic create-new and identity-bound deletion require a native host. */
export class BrowserAutomaticFiles {
  get available() { return false; }
  get canCreate() { return false; }
  get canPrune() { return false; }
}
