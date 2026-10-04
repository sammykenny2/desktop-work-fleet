import { NativeTransfers } from '../storage/native.js';
import { requireValue } from '../core/contracts.js';

export class NativeFiles {
  #bridge; #transfers; #maximum;
  constructor(bridge, info) { this.#bridge = bridge; this.#transfers = new NativeTransfers(bridge, info); this.#maximum = info.maxBackupBytes; }
  async export(bytes, name, action = 'save') {
    requireValue(bytes instanceof Uint8Array && bytes.length <= this.#maximum, 'file-capacity', '檔案超過此裝置的匯出容量。');
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
        requireValue(blob.size <= this.#maximum, 'file-capacity', '檔案超過此裝置的匯出容量。');
        const result = await this.export(new Uint8Array(await blob.arrayBuffer()), link.download || 'work-fleet-export');
        report(result.completed ? '已匯出檔案' : '已取消匯出');
      })().catch(error => report(error.message, true));
    };
    document.addEventListener('click', handle, true);
    return () => document.removeEventListener('click', handle, true);
  }
}
