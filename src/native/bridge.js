import { FleetError, requireValue } from '../core/contracts.js';

const MAX_MESSAGE_BYTES = 1024 * 1024;

/** Native channels carry bounded data and explicit password enrollment, never executable source, paths, SQL or saved credentials. */
export class NativeBridge {
  #transport; #pending = new Map(); #listeners = new Set(); #closed = false; #receive; #timeout;
  constructor(transport, { timeout = 120_000 } = {}) {
    this.#transport = transport; this.#timeout = timeout;
    this.#receive = event => {
      const message = event.data;
      if (!message || message.v !== 1) return;
      if (message.event === 'host-close-requested') {
        for (const listener of this.#listeners) listener(message.event); return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending || typeof message.ok !== 'boolean') return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new FleetError(message.error?.code || 'native-error', message.error?.message || '原生操作未完成。'));
    };
    transport.addEventListener('message', this.#receive);
  }
  request(method, params = {}) {
    if (this.#closed) return Promise.reject(new FleetError('native-closed', '原生連線已關閉，請重新開啟。'));
    requireValue(this.#pending.size < 24, 'native-busy', '原生儲存忙碌，請稍後重試。');
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const message = { v: 1, id, method, params };
      requireValue(new TextEncoder().encode(JSON.stringify(message)).length <= MAX_MESSAGE_BYTES, 'message-size', '原生訊息超過容量上限，尚未傳送。');
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new FleetError('native-outcome-unknown', '原生主機尚未確認結果；提交可能已完成，請保留草稿後重新開啟確認。'));
      }, this.#timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#transport.postMessage(message); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }
  onCloseRequested(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  close() {
    if (this.#closed) return; this.#closed = true;
    this.#transport.removeEventListener('message', this.#receive);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer); pending.reject(new FleetError('native-outcome-unknown', '原生連線已中斷；重新開啟可確認已提交資料。'));
    }
    this.#pending.clear(); this.#listeners.clear();
  }
}

export async function connectNative(view = globalThis) {
  const transport = view.chrome?.webview;
  if (!transport) return null;
  const bridge = new NativeBridge(transport);
  try {
    const info = await bridge.request('host.info');
    requireValue(info?.protocol === 1 && info.platform === 'windows' && typeof info.profileId === 'string'
      && info.capabilities?.nativeStorage === true && info.maxChunkBytes === 256 * 1024,
    'native-version', '此原生主機與介面版本不相容，請更新完整 App。');
    return { bridge, info };
  } catch (error) { bridge.close(); throw error; }
}
