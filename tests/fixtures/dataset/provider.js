import { copy } from '../../../src/core/contracts.js';
import { datasetQuery, validateDatasetFile } from '../../../src/sources/dataset-codec.js';
import { sha256 } from '../../../src/sources/files.js';

export class DatasetTestJournal {
  jobs = new Map();
  async getJob(key) { return copy(this.jobs.get(key) ?? null); }
  async putJob(key, value) { this.jobs.set(key, copy(value)); }
  async deleteJob(key) { this.jobs.delete(key); }
}

/** Isolated app-data model. Lazy unrelated history is counted but never materialized or returned by current queries. */
export class DatasetTestProvider {
  files = new Map(); events = []; counter = 0; journal = new Map(); hook = async () => {};
  unrelatedHistory = 0; forbiddenHistory = false;
  stats = { lists: 0, gets: 0, bytes: 0, historyReads: 0, creates: 0, deletes: 0 };
  get sourceId() { return 'google-drive:test:appdata-v1'; }
  async allocateFileId() { return `drive-${++this.counter}`; }
  async getJob(key) { return copy(this.journal.get(key) ?? null); }
  async putJob(key, value) { this.journal.set(key, copy(value)); }
  async deleteJob(key) { this.journal.delete(key); }
  async getStartCursor() { await this.hook('cursor'); return String(this.events.length); }
  async getObject({ id }) {
    await this.hook('get', id); this.stats.gets++;
    if (!this.files.has(id)) throw Object.assign(new Error('missing'), { code: 'source-file-missing' });
    return copy(this.files.get(id).file);
  }
  async readObject({ file }) {
    await this.hook('read', file.id); const stored = this.files.get(file.id);
    if (!stored) throw Object.assign(new Error('missing'), { code: 'source-file-missing' });
    if (file.kind === 'revision') this.stats.historyReads++;
    if (file.kind === 'revision' && this.forbiddenHistory) throw new Error('forbidden historical body read');
    this.stats.bytes += stored.bytes.length; return new Uint8Array(stored.bytes);
  }
  async createObject({ file, bytes }) {
    validateDatasetFile(file); await this.hook('create-before', file.id);
    if (this.files.has(file.id)) throw Object.assign(new Error('exists'), { code: 'file-exists' });
    if (file.parentId !== 'appDataFolder' && !this.files.has(file.parentId)) throw Object.assign(new Error('missing parent'), { code: 'source-file-missing' });
    if (file.sha256 !== undefined && (bytes.length !== file.size || await sha256(bytes) !== file.sha256)) throw new Error('bad bytes');
    this.files.set(file.id, { file: copy(file), bytes: new Uint8Array(bytes ?? []) });
    this.events.push({ id: file.id, file: copy(file), removed: false }); this.stats.creates++;
    await this.hook('create-after', file.id); return copy(file);
  }
  async createFolder({ file }) { return this.createObject({ file }); }
  async readFile({ file }) { return this.readObject({ file }); }
  async createFile({ file, bytes }) {
    await this.hook('create-before', file.id);
    if (this.files.has(file.id)) throw Object.assign(new Error('exists'), { code: 'file-exists' });
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) throw new Error('bad bytes');
    this.files.set(file.id, { file: copy(file), bytes: new Uint8Array(bytes) });
    this.events.push({ id: file.id, file: copy(file), removed: false }); this.stats.creates++;
    await this.hook('create-after', file.id); return copy(file);
  }
  async deleteFile({ id }) {
    await this.hook('delete-before', id); const stored = this.files.get(id);
    if (!stored) return;
    for (const child of [...this.files.values()].filter(item => item.file.parentId === id)) await this.deleteFile({ id: child.file.id });
    this.files.delete(id); this.events.push({ id, removed: true }); this.stats.deletes++;
    await this.hook('delete-after', id);
  }
  async listObjects({ query, pageToken = null }) {
    datasetQuery(query); await this.hook('list', query); this.stats.lists++;
    if (query.scope === 'legacy' && this.unrelatedHistory) throw new Error('forbidden whole-account history scan');
    const files = [...this.files.values()].map(item => item.file).filter(file => {
      if (query.scope === 'legacy') return true;
      if (query.scope === 'fences') return file.kind === 'reset';
      if (query.scope === 'datasets') return file.kind === 'dataset';
      if (file.datasetId !== query.datasetId) return false;
      if (query.scope === 'ready') return file.kind === 'ready';
      if (query.scope === 'roots') return file.kind === 'dataset-root' && file.parentId === 'appDataFolder';
      if (query.scope === 'current') return ['change', 'checkpoint'].includes(file.kind) && file.shard === query.shard;
      if (query.scope === 'current-all') return ['change', 'checkpoint'].includes(file.kind);
      if (query.scope === 'history') return file.kind === 'revision' && file.parentId === query.parentId;
      if (query.scope === 'children') return file.parentId === query.parentId;
      if (query.scope === 'purges') return file.kind === 'purge' && query.entities.includes(file.entityId);
      if (query.scope === 'entity-folders') return file.kind === 'folder' && query.entities.includes(file.entityId);
      if (query.scope === 'entity-data') return ['revision', 'attachment', 'folder'].includes(file.kind) && query.entities.includes(file.entityId);
      return false;
    }).sort((a, b) => a.id.localeCompare(b.id));
    // Cursor uses an identity boundary so concurrent removal does not shift an offset.
    const remaining = files.filter(file => !pageToken || file.id.localeCompare(pageToken) > 0);
    const result = remaining.slice(0, 100);
    return { files: copy(query.scope === 'legacy' ? result.map(file => ({ id: file.id, kind: file.kind,
      folder: ['dataset-root', 'folder'].includes(file.kind) })) : result), incomplete: false,
    nextPageToken: remaining.length > result.length ? result.at(-1).id : null };
  }
  async listDatasetChanges({ cursor }) {
    await this.hook('changes', cursor);
    const changes = this.events.slice(Number(cursor), Number(cursor) + 100);
    const next = Number(cursor) + changes.length;
    return { changes: copy(changes), ...(next < this.events.length ? { nextCursor: String(next) } : { cursor: String(next) }) };
  }
}
