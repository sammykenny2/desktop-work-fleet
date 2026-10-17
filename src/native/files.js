import { NativeTransfers } from '../storage/native.js';
import { requireValue } from '../core/contracts.js';
import { t } from '../i18n/index.js';

export class NativeFiles {
  #bridge; #transfers; #maximum;
  constructor(bridge, info) { this.#bridge = bridge; this.#transfers = new NativeTransfers(bridge, info); this.#maximum = info.maxBackupBytes; }
  async export(bytes, name, action = 'save') {
    requireValue(bytes instanceof Uint8Array && bytes.length <= this.#maximum, 'file-capacity', t('errors.storage.exportTooLarge'));
    const token = await this.#transfers.upload('backup', bytes);
    try { return await this.#bridge.request('file.export', { token, name: String(name).slice(0, 240), action }); }
    finally { await this.#transfers.discard(token); }
  }
  interceptDownloads(report) {
    const handle = event => {
      const link = event.target?.closest?.('a[download]');
      if (!link?.href.startsWith('blob:')) return;
      event.preventDefault();
      void (async () => {
        const response = await fetch(link.href); const blob = await response.blob();
        requireValue(blob.size <= this.#maximum, 'file-capacity', t('errors.storage.exportTooLarge'));
        const result = await this.export(new Uint8Array(await blob.arrayBuffer()), link.download || 'work-fleet-export');
        report(result.completed ? t('backup.export.fileExported') : t('backup.export.cancelled'));
      })().catch(error => report(error.message, true));
    };
    document.addEventListener('click', handle, true);
    return () => document.removeEventListener('click', handle, true);
  }
}
