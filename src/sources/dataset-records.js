import { copy } from '../core/contracts.js';
import { canonicalJson } from './json.js';

const LIMIT_BYTES = 32 * 1024 * 1024;
// A record held in memory costs more than its file's size, so even the smallest still counts for something.
const SMALLEST_CHARGE = 1024;

/**
 * Immutable dataset records this session already verified, in memory only and bounded by size.
 * A record's bytes never change for one exact descriptor, so this answers "what does it say" and never "does it still
 * exist": a caller needs fresh evidence of that from Drive (ADR-065).
 */
export class VerifiedRecords {
  #entries = new Map(); #bytes = 0; #limit;
  constructor({ limit = LIMIT_BYTES } = {}) { this.#limit = limit; }
  get(file) {
    const key = canonicalJson(file), entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key); this.#entries.set(key, entry);
    return copy(entry.value);
  }
  set(file, value) {
    const key = canonicalJson(file), charge = Math.max(file.size, SMALLEST_CHARGE), previous = this.#entries.get(key);
    if (previous) { this.#entries.delete(key); this.#bytes -= previous.charge; }
    if (charge > this.#limit) return;
    this.#entries.set(key, { value: copy(value), charge }); this.#bytes += charge;
    for (const [oldest, entry] of this.#entries) {
      if (this.#bytes <= this.#limit) break;
      this.#entries.delete(oldest); this.#bytes -= entry.charge;
    }
  }
}
