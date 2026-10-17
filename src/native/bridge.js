import { FleetError, requireValue } from '../core/contracts.js';
import { hasMessage, t } from '../i18n/index.js';

const MAX_MESSAGE_BYTES = 1024 * 1024;

/**
 * Hosts reply with a stable code and an English message. A code with a catalog entry is shown in the UI language;
 * any other code keeps the host's message (docs/i18n.md).
 */
export function nativeError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'native-error';
  const key = `nativeErrors.${code}`;
  return new FleetError(code, hasMessage(key) ? t(key) : error?.message || t('nativeErrors.native-error'));
}

/** Native channels carry bounded data and explicit password enrollment, never executable source, paths, SQL or saved credentials. */
export class NativeBridge {
  #transport; #pending = new Map(); #listeners = new Set(); #events = new Map(); #closed = false; #receive; #timeout;
  constructor(transport, { timeout = 120_000 } = {}) {
    this.#transport = transport; this.#timeout = timeout;
    this.#receive = event => {
      const message = event.data;
      if (!message || message.v !== 1) return;
      if (message.event === 'host-close-requested') {
        for (const listener of this.#listeners) listener(message.event); return;
      }
      if (typeof message.event === 'string') {
        for (const listener of this.#events.get(message.event) || []) listener(message); return;
      }
      const pending = this.#pending.get(message.id);
      if (!pending || typeof message.ok !== 'boolean') return;
      clearTimeout(pending.timer); this.#pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(nativeError(message.error));
    };
    transport.addEventListener('message', this.#receive);
  }
  request(method, params = {}) {
    if (this.#closed) return Promise.reject(new FleetError('native-closed', t('nativeErrors.native-closed')));
    requireValue(this.#pending.size < 24, 'native-busy', t('nativeErrors.native-busy'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const message = { v: 1, id, method, params };
      requireValue(new TextEncoder().encode(JSON.stringify(message)).length <= MAX_MESSAGE_BYTES, 'message-size', t('nativeErrors.message-size'));
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new FleetError('native-outcome-unknown', t('nativeErrors.native-outcome-unknown')));
      }, this.#timeout);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.#transport.postMessage(message); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }
  onCloseRequested(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  onEvent(name, listener) {
    if (!this.#events.has(name)) this.#events.set(name, new Set());
    this.#events.get(name).add(listener); return () => this.#events.get(name)?.delete(listener);
  }
  close() {
    if (this.#closed) return; this.#closed = true;
    this.#transport.removeEventListener('message', this.#receive);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer); pending.reject(new FleetError('native-outcome-unknown', t('nativeErrors.native-outcome-unknown.closed')));
    }
    this.#pending.clear(); this.#listeners.clear(); this.#events.clear();
  }
}

export function nativeTransport(view = globalThis) {
  let transport = view.chrome?.webview;
  if (!transport && (view.workFleet?.postMessage || view.webkit?.messageHandlers?.workFleet)) {
    const listeners = new Set();
    const receive = event => {
      let data = event?.data ?? event;
      try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
      for (const listener of listeners) listener({ data });
    };
    if (view.workFleet) view.workFleet.onmessage = receive;
    else view.__workFleetReceive = receive;
    transport = {
      postMessage: value => view.workFleet ? view.workFleet.postMessage(JSON.stringify(value)) : view.webkit.messageHandlers.workFleet.postMessage(value),
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
  }
  return transport ?? null;
}

export async function connectNative(view = globalThis) {
  const transport = nativeTransport(view);
  if (!transport) return null;
  const bridge = new NativeBridge(transport);
  try {
    const info = await bridge.request('host.info');
    requireValue(info?.protocol === 1 && ['windows', 'macos', 'linux', 'ios', 'android'].includes(info.platform) && typeof info.profileId === 'string'
      && info.capabilities?.nativeStorage === true && info.maxChunkBytes === 256 * 1024,
    'native-version', t('nativeErrors.native-version'));
    return { bridge, info };
  } catch (error) { bridge.close(); throw error; }
}
