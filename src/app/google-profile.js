const CACHE_KEY = 'google-profile';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;

function details(value) {
  const name = typeof value?.name === 'string' && value.name.length <= 256 ? value.name.trim() || null : null;
  let photo = null;
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(value?.photo?.type)
      && typeof value.photo.data === 'string' && value.photo.data.length <= 180000) {
    try {
      const size = atob(value.photo.data).length;
      if (size > 0 && size <= 128 * 1024) photo = { type: value.photo.type, data: value.photo.data };
    } catch { /* An unusable photo never replaces the last usable one. */ }
  }
  return { name, photo };
}

/** Optional display metadata in this account's local control records, outside notes, sync and backups. */
export class GoogleProfileCache {
  #storage; #request; #current; #changed; #now;
  #value = null; #updatedAt = null; #retryAt = 0; #restore = null; #pending = null;
  constructor({ accountId, storage, request, current, changed, now = Date.now }) {
    this.accountId = accountId; this.#storage = storage; this.#request = request;
    this.#current = current; this.#changed = changed; this.#now = now;
  }

  restore() {
    this.#restore ??= this.#read();
    return this.#restore;
  }

  async #read() {
    try {
      const saved = await this.#storage.getControl(CACHE_KEY);
      if (!this.#current() || saved?.accountId !== this.accountId) return;
      const value = details(saved);
      if (!value.name && !value.photo) return;
      this.#value = value;
      // Clock changes affect refresh timing, never whether the last known identity is displayed.
      this.#updatedAt = Number.isSafeInteger(saved.updatedAt) && saved.updatedAt >= 0 && saved.updatedAt <= this.#now()
        ? saved.updatedAt : null;
      this.#changed(value);
    } catch { /* A missing or unreadable display cache must not block opening notes. */ }
  }

  refresh() {
    if (!this.#pending) {
      const work = this.#refresh().finally(() => { if (this.#pending === work) this.#pending = null; });
      this.#pending = work;
    }
    return this.#pending;
  }

  async #refresh() {
    await this.restore();
    if (!this.#current() || this.#now() < this.#retryAt
        || this.#updatedAt !== null && this.#now() < this.#updatedAt + REFRESH_MS) return;
    try {
      const next = details(await this.#request());
      if (!this.#current()) return;
      if (!next.name && !next.photo) { this.#retryAt = this.#now() + RETRY_MS; return; }
      // Hosts return null when a photo download fails. Keep known details through partial/network failures.
      this.#value = { name: next.name ?? this.#value?.name ?? null, photo: next.photo ?? this.#value?.photo ?? null };
      this.#updatedAt = this.#now(); this.#retryAt = 0;
      this.#changed(this.#value);
      try { await this.#storage.putControl(CACHE_KEY, { accountId: this.accountId, ...this.#value, updatedAt: this.#updatedAt }); }
      catch { /* The refreshed identity remains usable in this window when caching is unavailable. */ }
    } catch { if (this.#current()) this.#retryAt = this.#now() + RETRY_MS; }
  }
}
