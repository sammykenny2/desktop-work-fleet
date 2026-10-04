import { copy, FleetError, requireValue } from '../core/contracts.js';
import { encode, upload, MAX_COMMAND } from './transport.js';

export class DesktopClient {
  #bridge; #info; #serial = 0; #sending = Promise.resolve(); #pending = new Map(); #unsubscribe;
  constructor(bridge, info) {
    this.#bridge = bridge; this.#info = info;
    this.#unsubscribe = bridge.onEvent('desktop-command-result', message => {
      const pending = this.#pending.get(message.commandId); if (!pending) return;
      clearTimeout(pending.timer); this.#pending.delete(message.commandId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new FleetError(message.error?.code || 'desktop-command', message.error?.message || '桌面操作未完成。'));
    });
  }
  command(method, args = {}, intent = null) {
    args = copy(args);
    const topology = this.#info.topology ?? 0;
    const draft = method === 'editor.change';
    requireValue([...this.#pending.values()].filter(p => p.draft === draft).length < (draft ? 4 : 24), 'desktop-busy', '桌面操作仍在處理，請稍候重試。');
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.#pending.delete(id); reject(new FleetError('desktop-unknown', '主畫面尚未確認保存，請保留文字後重試。'));
      }, 120_000);
      this.#pending.set(id, { resolve, reject, timer, draft });
      this.#sending = this.#sending.then(async () => {
        const command = { sessionId: this.#info.sessionId, id, serial: ++this.#serial, method, args };
        const bytes = encode(command); let token;
        try {
          if (bytes.length <= 64 * 1024) await this.#bridge.request('scene.command', { command, intent, topology });
          else {
            token = await upload(this.#bridge, 'scene.command', bytes, MAX_COMMAND, token => this.#bridge.request('scene.discard', { token }));
            await this.#bridge.request('scene.command', { token, intent, topology });
            // The native mailbox owns complete command bytes until the owner responds.
            token = null;
          }
        } finally { if (token) await this.#bridge.request('scene.discard', { token }).catch(() => {}); }
      }).catch(error => {
        const pending = this.#pending.get(id); if (!pending) return;
        clearTimeout(pending.timer); this.#pending.delete(id); pending.reject(error);
      });
    });
  }
  close() {
    this.#unsubscribe();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new FleetError('desktop-closed', '桌面視窗已關閉。')); }
    this.#pending.clear();
  }
}

/** Retains an uncertain in-flight text version for an exact sequence retry before sending newer input. */
export class DesktopDraft {
  #client; #pending = null; #flight = null;
  constructor(client, value) {
    this.#client = client; this.draftId = value.draftId; this.cardId = value.cardId;
    this.sequence = value.sequence; this.saved = value.text; this.text = value.text;
  }
  get dirty() { return this.#flight !== null || this.text !== this.saved; }
  flush() {
    if (this.#pending) return this.#pending;
    this.#pending = (async () => {
      while (this.dirty) {
        this.#flight ||= { draftId: this.draftId, sequence: this.sequence + 1, text: this.text };
        const result = await this.#client.command('editor.change', { ...this.#flight });
        if (result.sequence !== this.#flight.sequence) throw new FleetError('desktop-edit-order', '草稿保存回覆順序不符，文字仍保留。');
        this.sequence = result.sequence; this.saved = this.#flight.text; this.#flight = null;
      }
    })().finally(() => { this.#pending = null; });
    return this.#pending;
  }
}
