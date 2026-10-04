import { FleetError, requireValue } from '../core/contracts.js';
import { sha256 } from '../sources/files.js';
import { BACKUP_LIMITS, checkCancelled } from './archive.js';

export function backupFilename(now = new Date()) {
  return `work-fleet-backup-${now.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.zip`;
}

/** FileSystemFileHandle adapter; success requires close and a matching readback, not merely a queued write. */
export async function saveBackupToHandle(handle, { bytes, signal, progress = () => {} }) {
  requireValue(bytes instanceof Uint8Array && bytes.length <= BACKUP_LIMITS.encryptedBytes,
    'backup-limit', '備份檔案超過容量上限。');
  bytes = new Uint8Array(bytes); checkCancelled(signal);
  const writable = await handle.createWritable();
  let publishing = false;
  try {
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      checkCancelled(signal); await writable.write(bytes.subarray(offset, offset + 1024 * 1024));
      progress({ phase: 'save', completed: Math.min(bytes.length, offset + 1024 * 1024), total: bytes.length });
    }
    checkCancelled(signal);
    // close publishes the file. Once this boundary starts, finish verification even if a late abort arrives.
    progress({ phase: 'save-commit', completed: bytes.length, total: bytes.length });
    publishing = true; await writable.close(); const file = await handle.getFile();
    requireValue(file.size === bytes.length, 'backup-save-integrity', '檔案已寫入，但讀回大小不符，尚未確認備份成功。');
    requireValue(await sha256(new Uint8Array(await file.arrayBuffer())) === await sha256(bytes),
      'backup-save-integrity', '檔案已寫入，但讀回校驗失敗，尚未確認備份成功。');
    return { saved: true, receipt: crypto.randomUUID() };
  } catch (error) {
    try { await writable.abort(); } catch { /* Already closed or failed: there is no rollback promise. */ }
    if (publishing && error.code !== 'backup-save-integrity') throw new FleetError('backup-save-unconfirmed',
      '檔案可能已寫入，但保存或讀回未完成。請檢查目的檔後重試，尚未確認備份成功。');
    throw error;
  }
}

export function browserBackupFiles() {
  return {
    canConfirmSave: typeof globalThis.showSaveFilePicker === 'function',
    // Called directly in the click handler, before compression/KDF can consume transient user activation.
    async chooseDestination({ suggestedName = backupFilename(), requireConfirmed = false } = {}) {
      if (typeof globalThis.showSaveFilePicker === 'function') {
        const handle = await globalThis.showSaveFilePicker({ suggestedName, types: [{ description: 'Work Fleet 備份', accept: { 'application/zip': ['.zip'] } }] });
        return { save: value => saveBackupToHandle(handle, value) };
      }
      requireValue(!requireConfirmed, 'backup-save-unavailable', '此環境只能交付下載，請使用支援確認保存的 App 或瀏覽器後再取代。');
      return { save: async ({ bytes, signal }) => {
        checkCancelled(signal); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const link = document.createElement('a'); link.href = url; link.download = suggestedName;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        return { saved: false, downloaded: true };
      } };
    },
  };
}
