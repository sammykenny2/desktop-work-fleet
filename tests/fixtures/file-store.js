import assert from 'node:assert/strict';
import { copy, FleetError } from '../../src/core/contracts.js';
import { sha256, verifyFile } from '../../src/sources/files.js';

/** Deterministic transport fixture. Fault hooks run at the remote boundary, not in the coordinator. */
export class MemoryFileStore {
  sourceId = 'drive:account-a:app-data';
  files = new Map();
  changes = [];
  calls = [];
  pageSize = 2;
  hooks = {};
  #id = 0;

  async #before(method, input) {
    this.calls.push({ method, ...copy(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'signal'))) });
    await this.hooks[method]?.(input, this);
  }

  async seed(bytes, kind = 'revision', id = `seed-${++this.#id}`) {
    const file = { id, kind, size: bytes.length, sha256: await sha256(bytes) };
    this.files.set(id, { file, bytes: copy(bytes) });
    this.changes.push({ id, removed: false, file: copy(file) });
    return copy(file);
  }

  async getStartCursor(input) {
    const cursor = String(this.changes.length);
    await this.#before('getStartCursor', input); return cursor;
  }

  async listFiles(input) {
    await this.#before('listFiles', input);
    const offset = Number(input.pageToken ?? 0); const files = [...this.files.values()].map(item => copy(item.file));
    return { files: files.slice(offset, offset + this.pageSize),
      nextPageToken: offset + this.pageSize < files.length ? String(offset + this.pageSize) : null };
  }

  async listChanges(input) {
    await this.#before('listChanges', input);
    const offset = Number(input.cursor); const next = offset + this.pageSize;
    return { changes: copy(this.changes.slice(offset, next)),
      ...(next < this.changes.length ? { nextCursor: String(next) } : { cursor: String(this.changes.length) }) };
  }

  async allocateFileId(input) { await this.#before('allocateFileId', input); return `file-${++this.#id}`; }

  async readFile(input) {
    await this.#before('readFile', input);
    const entry = this.files.get(input.file.id);
    if (!entry) throw new FleetError('source-file-missing', 'fixture file missing');
    return copy(entry.bytes);
  }

  async createFile(input) {
    await this.#before('createFile', input);
    if (this.files.has(input.file.id)) throw new FleetError('file-exists', 'fixture 409');
    await verifyFile(input.file, input.bytes);
    this.files.set(input.file.id, { file: copy(input.file), bytes: copy(input.bytes) });
    this.changes.push({ id: input.file.id, removed: false, file: copy(input.file) });
    await this.hooks.afterCreate?.(input, this);
    return copy(input.file);
  }
}

export class MemoryAttachmentStorage {
  entries = new Map();
  async putAttachmentBytes(profileId, id, bytes) {
    assert.equal(await sha256(bytes), id);
    this.entries.set(`${profileId}:${id}`, new Blob([copy(bytes)], { type: 'application/octet-stream' }));
  }
  async getAttachment(profileId, id) { return this.entries.get(`${profileId}:${id}`) ?? null; }
}

export function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
