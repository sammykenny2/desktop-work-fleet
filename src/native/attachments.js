export class NativeAttachments {
  #bridge; #cache = new Map();
  constructor(bridge) { this.#bridge = bridge; }
  preview(file) {
    const key = JSON.stringify([file.id, file.name]);
    if (!this.#cache.has(key)) {
      if (this.#cache.size >= 64) this.#cache.delete(this.#cache.keys().next().value);
      const pending = this.#bridge.request('attachment.preview', { id: file.id, name: file.name }).then(result => {
        if (!result.available) this.#cache.delete(key); return result;
      }).catch(error => { this.#cache.delete(key); throw error; });
      this.#cache.set(key, pending);
    }
    return this.#cache.get(key);
  }
  open(file) { return this.#bridge.request('attachment.open', { id: file.id, name: file.name }); }
}
