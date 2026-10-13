/** Coalesce durable layout settings without repeatedly releasing/re-registering unchanged OS chords. */
export class NativeShortcutSettings {
  #bridge; #changed; #error; #unsub; #pending; #task; #attempted; #closed = false;
  constructor(bridge, changed, error) {
    this.#bridge = bridge; this.#changed = changed; this.#error = error;
    this.#unsub = bridge.onEvent('desktop-shortcut-status', value => changed(value.registrations, value.labwc ?? null));
  }
  update(bindings, retry = false) {
    const values = Object.entries(bindings).sort(([a], [b]) => a.localeCompare(b)).map(([key, target]) => ({ key, target }));
    const fingerprint = JSON.stringify(values);
    if (this.#closed || !retry && fingerprint === this.#attempted) return this.#task;
    this.#attempted = fingerprint; this.#pending = values;
    if (this.#task) return this.#task;
    this.#task = (async () => {
      while (this.#pending && !this.#closed) {
        const bindings = this.#pending; this.#pending = null;
        try { const value = await this.#bridge.request('desktop.shortcuts.configure', { bindings }); if (!this.#closed) this.#changed(value.registrations, value.labwc ?? null); }
        catch (error) { if (!this.#closed) this.#error(error); }
      }
    })().finally(() => { this.#task = null; if (this.#pending && !this.#closed) this.update(Object.fromEntries(this.#pending.map(b => [b.key, b.target])), true); });
    return this.#task;
  }
  // labwc keybinds live in the user's rc.xml, so they are written only when asked, after the bindings settle.
  async writeLabwc() {
    await this.#task; const value = await this.#bridge.request('desktop.shortcuts.labwc', {});
    if (!this.#closed) this.#changed(value.registrations, value.labwc ?? null);
  }
  close() { this.#closed = true; this.#pending = null; this.#unsub(); }
}
