import { FleetError } from '../core/contracts.js';
import { download, encode, parse, upload, MAX_FRAME, MAX_COMMAND } from './transport.js';

/** The owner publishes projections and dispatches commands; it does not add another durable store. */
export class DesktopOwner {
  #bridge; #authority; #project; #changed; #error; #lost; #editor; #unsub = []; #closed = false;
  #sequence = 0; #dirty = false; #publishing = null; #incoming = Promise.resolve(); #actions = Promise.resolve(); #flushes = new Map(); #frozen = new Set();
  #closing = false; #sealed = false;
  #published = 0; #publishError;
  constructor({ bridge, authority, project, changed, error, lost, dismiss, editor, displays }) {
    this.#bridge = bridge; this.#authority = authority; this.#project = project; this.#changed = changed; this.#error = error; this.#lost = lost; this.#editor = editor;
    this.#unsub.push(bridge.onEvent('desktop-command', message => {
      // Decode large commands in event order, then admit without waiting for the other execution lane.
      this.#incoming = this.#incoming.then(async () => {
        const command = message.command ?? parse(await download(message.transfer,
          offset => bridge.request('desktop.command.read', { ticket: message.ticket, offset }), MAX_COMMAND));
        if (this.#closed) return;
        void this.#command(message, command);
      }).catch(error => { void this.#reply(message.ticket, false, error).catch(this.#error); });
    }));
    this.#unsub.push(bridge.onEvent('desktop-flushed', message => {
      const pending = this.#flushes.get(message.id);
      if (!pending || pending.viewId !== message.viewId || pending.draftId !== message.draftId) return;
      this.#flushes.delete(message.id); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.sequence);
      else pending.reject(new FleetError('desktop-flush', '請先完成桌面輸入或修復草稿保存，再切換調整範圍。'));
    }));
    this.#unsub.push(bridge.onEvent('desktop-view-lost', message => {
      authority.removeView(message.viewId);
      for (const [id, pending] of this.#flushes) if (pending.viewId === message.viewId) {
        clearTimeout(pending.timer); this.#flushes.delete(id); pending.reject(new FleetError('desktop-view', '編輯視窗已中斷，最後確認草稿保留於主畫面。'));
      }
      void Promise.resolve(this.#lost(message.viewId)).then(this.#changed).catch(this.#error);
      this.#error(new FleetError('desktop-view', message.message));
    }));
    this.#unsub.push(bridge.onEvent('desktop-dismiss', () => { void this.perform(dismiss).catch(this.#error); }));
    this.#unsub.push(bridge.onEvent('desktop-error', message => this.#error(new FleetError('desktop-view', message.message))));
    this.#unsub.push(bridge.onEvent('desktop-displays-changing', () => authority.invalidateDisplays()));
    this.#unsub.push(bridge.onEvent('desktop-displays', message => {
      authority.invalidateDisplays();
      void this.perform(async () => {
        if (this.#closing || this.#closed) return;
        await displays(message);
      }).catch(this.#error);
    }));
  }
  perform(action) {
    const next = this.#actions.then(async () => {
      try { return await action(); }
      finally { if (!this.#closing) await this.#release(); }
    });
    this.#actions = next.catch(() => {}); return next;
  }
  async #release() {
    const ids = [...this.#frozen]; this.#frozen.clear();
    const editor = this.#editor();
    for (const id of ids) await this.#bridge.request('desktop.flush.release', { id, viewId: editor?.viewId ?? null, draftId: editor?.draftId ?? null }).catch(() => {});
  }
  async #reply(ticket, ok, result) {
    await this.#bridge.request('desktop.reply', { ticket, ok,
      ...(ok ? { result: result ?? null } : { error: { code: result.code || 'desktop-command', message: String(result.message).slice(0,2000) } }) });
  }
  async #command(message, command) {
    try {
      if (this.#sealed || this.#closing && command.method !== 'editor.change') throw new FleetError('desktop-closing', 'App 正在保存並關閉，請稍候。');
      const result = await this.#authority.request(message.viewId, command, { intent: message.intent ?? null, topology: message.topology ?? 0 });
      if (this.#closed) return;
      if (command.method !== 'attachment.preview') this.#changed();
      // Keep the scene's drag preview until the native mailbox contains the committed or cancelled geometry.
      if (command.method === 'pointer.up' || command.method === 'pointer.cancel') await this.whenPublished();
      await this.#reply(message.ticket, true, result);
    } catch (error) { if (!this.#closed) { this.#error(error); await this.#reply(message.ticket, false, error).catch(this.#error); } }
  }
  publish() {
    if (this.#closed) return;
    this.#dirty = true;
    if (this.#publishing) return;
    this.#publishing = (async () => {
      while (this.#dirty && !this.#closed) {
        this.#dirty = false;
        const bytes = encode(this.#project(++this.#sequence)); let token;
        try {
          token = await upload(this.#bridge, 'desktop.frame', bytes, MAX_FRAME, token => this.#bridge.request('desktop.frame.discard', { token }));
          await this.#bridge.request('desktop.frame.publish', { token });
          this.#published = this.#sequence; this.#publishError = null;
        } finally { if (token) await this.#bridge.request('desktop.frame.discard', { token }).catch(() => {}); }
      }
    })().catch(error => {
      this.#publishError = error;
      this.#error(error);
      if (error.code === 'scene-busy') setTimeout(() => this.publish(), 250);
    }).finally(() => { this.#publishing = null; if (this.#dirty && !this.#closed) this.publish(); });
  }
  async whenPublished() {
    while (this.#publishing) await this.#publishing;
    if (this.#publishError) throw this.#publishError;
    return this.#published;
  }
  flush(editor) {
    const id = crypto.randomUUID(); this.#frozen.add(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#flushes.delete(id); reject(new FleetError('desktop-flush', '桌面編輯仍未確認保存，已保留目前操作。'));
        void this.#bridge.request('desktop.flush.cancel', { id }).catch(() => {});
      }, 30_000);
      this.#flushes.set(id, { viewId: editor.viewId, draftId: editor.draftId, resolve, reject, timer });
      this.#bridge.request('desktop.flush', { viewId: editor.viewId, draftId: editor.draftId, id }).catch(error => {
        clearTimeout(timer); this.#flushes.delete(id); reject(error);
      });
    });
  }
  async whenIdle() { await this.#incoming; await this.#authority.whenIdle(); await this.#actions; await this.#publishing; }
  beginClose() { this.#closing = true; }
  sealClose() { this.#sealed = true; }
  async cancelClose() { this.#closing = false; this.#sealed = false; await this.#release(); }
  close() {
    this.#closed = true; for (const unsubscribe of this.#unsub) unsubscribe(); this.#authority.close();
    for (const pending of this.#flushes.values()) { clearTimeout(pending.timer); pending.reject(new FleetError('desktop-closed', '桌面工作階段已關閉。')); }
    this.#flushes.clear();
  }
}
