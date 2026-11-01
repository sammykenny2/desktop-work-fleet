import { copy, requireValue } from '../core/contracts.js';
import { CURRENT_WORKSPACE_FORMAT } from '../core/workspace.js';
import { canonicalJson } from '../sources/json.js';
import { sha256 } from '../sources/files.js';
import { t } from '../i18n/index.js';
import { RECORD_LIMITS, recordTransaction } from './records.js';

const omitted = new Set(['revision', 'groups', 'cards', 'revisions', 'drafts', 'outbox', 'conflicts']);
const equal = (a, b) => a === b || (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b));
const stale = condition => requireValue(condition, 'stale-writer', t('errors.storage.staleWriter'));
const encoder = new TextEncoder();

/** Current state is a small independently loadable view. History and pending uploads are indexed records. */
export class WorkspaceRecordStorage {
  #store; #legacy; #profile; #receipt = null; #active = null; #tail = Promise.resolve();
  constructor(store, profileId, { legacy = null } = {}) {
    this.#store = store; this.#profile = profileId; this.#legacy = legacy;
  }
  #check(profileId) { requireValue(profileId === this.#profile, 'invalid-profile', t('errors.storage.profileMismatch')); }
  #queue(work) { const result = this.#tail.then(work); this.#tail = result.catch(() => {}); return result; }
  #key(id, generation = this.#active.generation) { return `${generation}:${id}`; }
  #historyGeneration() { return this.#active.historyGeneration ?? this.#active.generation; }
  #row(collection, id, value, entity = this.#active.generation, generation = this.#active.generation) {
    const revision = (this.#receipt?.revision ?? -1) + 1;
    return { collection, key: this.#key(id, generation), entity, ordinal: revision, value };
  }
  async #write(puts, deletes = [], attachments = []) {
    const expected = this.#receipt?.revision ?? null;
    const transaction = recordTransaction(this.#profile, expected,
      puts.map(row => ({ ...row, ordinal: row.collection === 'outbox' ? row.ordinal : (expected ?? -1) + 1 })), deletes);
    this.#receipt = await this.#store.commit(transaction, expected, { attachments });
  }
  async #status() {
    const status = await this.#store.status(this.#profile);
    requireValue(status?.format !== 'legacy-workspace', 'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
    return status;
  }
  async #rows(collection, entity, expectedRevision) {
    const rows = []; let after = null;
    do {
      const page = await this.#store.page(this.#profile, { collection, entity, after, expectedRevision });
      rows.push(...page.rows); after = page.next;
    } while (after);
    return rows;
  }
  async load(profileId) {
    this.#check(profileId);
    return this.#queue(async () => {
      this.#receipt = await this.#status();
      const active = await this.#store.get(profileId, 'meta', 'active');
      if (!active) { this.#active = null; return null; }
      const { generation, revision } = active.value;
      const expected = this.#receipt.revision;
      const results = await Promise.all(['meta', 'current', 'draft'].map(collection => this.#rows(collection, generation, expected)));
      stale((await this.#status())?.revision === expected);
      const state = Object.fromEntries(results[0].map(row => [row.key.slice(generation.length + 1), row.value]));
      requireValue(state.format === CURRENT_WORKSPACE_FORMAT && state.profileId === profileId,
        'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
      Object.assign(state, { revision, groups: [], cards: [], conflicts: [], outbox: [],
        revisions: results[1].map(row => row.value), drafts: Object.fromEntries(results[2].map(row => [row.value.id, row.value])) });
      // Workspace derives groups/cards/conflicts from the current revision envelopes.
      for (const record of state.revisions) state[record.kind === 'card' ? 'cards' : 'groups'].push(record.value);
      this.#active = active.value; return state;
    });
  }
  save(state, expectedRevision, detail = {}) {
    return this.#queue(() => this.#save(state, expectedRevision, detail));
  }
  async #save(state, expectedRevision, detail) {
    this.#check(state.profileId); stale((this.#active?.revision ?? null) === expectedRevision);
    stale(state.revision === (expectedRevision === null ? 0 : expectedRevision + 1));
    requireValue(state.format === CURRENT_WORKSPACE_FORMAT, 'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
    if (!this.#receipt) {
      this.#receipt = await this.#status();
      stale(await this.#store.get(this.#profile, 'meta', 'active') === null);
    }
    if (!this.#active || detail.replaceGeneration) return this.#stage(state, detail);
    const generation = this.#active.generation, previous = detail.previous;
    requireValue(previous, 'invalid-record-transaction', t('errors.storage.recordTransactionInvalid'));
    const puts = [], deletes = [];
    if (!detail.draftsOnly) {
      for (const [key, value] of Object.entries(state)) if (!omitted.has(key) && !equal(value, previous[key])) puts.push(this.#row('meta', key, value));
      for (const key of Object.keys(previous)) if (!omitted.has(key) && !Object.hasOwn(state, key)) deletes.push({ collection: 'meta', key: this.#key(key) });
      const old = new Map(previous.revisions.map(row => [row.revisionId, row]));
      for (const record of state.revisions) {
        if (!old.has(record.revisionId)) puts.push(this.#row('current', record.revisionId, record));
        old.delete(record.revisionId);
      }
      for (const id of old.keys()) deletes.push({ collection: 'current', key: this.#key(id) });
    }
    for (const [id, draft] of Object.entries(state.drafts)) if (!equal(draft, previous.drafts[id])) puts.push(this.#row('draft', id, draft));
    for (const id of Object.keys(previous.drafts)) if (!Object.hasOwn(state.drafts, id)) deletes.push({ collection: 'draft', key: this.#key(id) });
    for (const record of detail.additions ?? []) puts.push(this.#row('history', record.revisionId, record,
      this.#key(`${record.kind}:${record.entityId}`, this.#historyGeneration()), this.#historyGeneration()));
    for (const operation of detail.pending ?? []) puts.push(this.#row('outbox', operation.operationId, operation));
    for (const id of detail.removedOperations ?? []) {
      stale(await this.#store.get(this.#profile, 'outbox', this.#key(id)) !== null);
      deletes.push({ collection: 'outbox', key: this.#key(id) });
    }
    for (const key of detail.removedJobs ?? []) deletes.push({ collection: 'job', key });
    const active = { ...this.#active, revision: state.revision };
    puts.push({ collection: 'meta', key: 'active', entity: '', ordinal: 0, value: active });
    if (puts.length + deletes.length > RECORD_LIMITS.rows
      || encoder.encode(canonicalJson({ puts, deletes })).length > RECORD_LIMITS.transactionBytes - 2048) return this.#stage(state, detail);
    await this.#write(puts, deletes, detail.attachments); this.#active = active;
  }
  /** Bulk replacement builds an isolated generation; a single pointer publishes it after every chunk is durable. */
  async #stage(state, detail) {
    const generation = crypto.randomUUID();
    const keepHistory = Boolean(this.#active && !detail.replaceGeneration);
    const historyGeneration = keepHistory ? this.#historyGeneration() : generation;
    const oldPending = keepHistory ? (await this.#rows('outbox', this.#active.generation, this.#receipt.revision))
      .filter(row => !detail.removedOperations?.includes(row.value.operationId)) : [];
    const row = (collection, id, value, entity = generation) => this.#row(collection, id, value, entity, generation);
    const rows = Object.entries(state).filter(([key]) => !omitted.has(key)).map(([key, value]) => row('meta', key, value));
    rows.push(...state.revisions.map(record => row('current', record.revisionId, record)),
      ...Object.values(state.drafts).map(draft => row('draft', draft.id, draft)),
      ...(detail.history ?? detail.additions ?? (keepHistory ? [] : state.revisions)).map(record => this.#row('history', record.revisionId, record,
        `${historyGeneration}:${record.kind}:${record.entityId}`, historyGeneration)),
      ...oldPending.map(item => ({ ...row('outbox', item.value.operationId, item.value), ordinal: item.ordinal })),
      ...(detail.pending ?? []).map(operation => row('outbox', operation.operationId, operation)));
    let chunk = [], bytes = 1024;
    for (const item of rows) {
      const size = encoder.encode(canonicalJson(item)).length + 1;
      if (chunk.length && (chunk.length >= 400 || bytes + size > RECORD_LIMITS.transactionBytes - 1024)) {
        await this.#write(chunk); chunk = []; bytes = 1024;
      }
      chunk.push(item); bytes += size;
    }
    if (chunk.length) await this.#write(chunk);
    for (const attachment of detail.attachments ?? []) await this.#write([], [], [attachment]);
    const active = { generation, historyGeneration, revision: state.revision };
    await this.#write([{ collection: 'meta', key: 'active', entity: '', ordinal: 0, value: active }],
      (detail.removedJobs ?? []).map(key => ({ collection: 'job', key })));
    this.#active = active;
  }
  async page(kind, entityId, { after = null, limit = 50 } = {}) {
    const generation = this.#historyGeneration();
    stale(!after || after.generation === generation);
    const status = await this.#status();
    const result = await this.#store.page(this.#profile, { collection: 'history', entity: `${generation}:${kind}:${entityId}`,
      after: after?.position ?? null, limit, expectedRevision: status.revision });
    stale(this.#historyGeneration() === generation);
    return { records: result.rows.map(row => row.value), next: result.next ? { generation, position: result.next } : null };
  }
  async get(id) { return (await this.#store.get(this.#profile, 'history', this.#key(id, this.#historyGeneration())))?.value ?? null; }
  async #control(collection, key) { return (await this.#store.get(this.#profile, collection, key))?.value ?? null; }
  #putControl(collection, key, value) {
    return this.#queue(async () => {
      this.#receipt ??= await this.#status();
      await this.#write([{ collection, key, entity: '', ordinal: 0, value: copy(value) }]);
    });
  }
  #deleteControl(collection, key) { return this.#queue(() => this.#write([], [{ collection, key }])); }
  getJob(key) { return this.#control('job', key); }
  putJob(key, value) { return this.#putControl('job', key, value); }
  deleteJob(key) { return this.#deleteControl('job', key); }
  getControl(key) { return this.#control('control', key); }
  putControl(key, value) { return this.#putControl('control', key, value); }
  deleteControl(key) { return this.#deleteControl('control', key); }
  cacheHistory(records) {
    return this.#queue(() => this.#write(records.map(record => this.#row('history', record.revisionId, record,
      this.#key(`${record.kind}:${record.entityId}`, this.#historyGeneration()), this.#historyGeneration()))));
  }
  async pendingPage({ after = null, limit = 50 } = {}) {
    const generation = this.#active.generation; stale(!after || after.generation === generation);
    const status = await this.#status();
    const result = await this.#store.page(this.#profile, { collection: 'outbox', entity: generation, after: after?.position ?? null,
      limit, order: 'asc', expectedRevision: status.revision });
    return { operations: result.rows.map(row => row.value), next: result.next ? { generation, position: result.next } : null };
  }
  async completeHistory(state) {
    const entities = new Map(state.revisions.map(row => [`${row.kind}:${row.entityId}`, row]));
    const records = [];
    for (const { kind, entityId } of entities.values()) {
      let after = null;
      do { const page = await this.page(kind, entityId, { after }); records.push(...page.records); after = page.next; } while (after);
    }
    return records;
  }
  async putAttachment(profileId, file) {
    this.#check(profileId);
    requireValue(file instanceof Blob && file.size <= RECORD_LIMITS.attachmentBytes, 'attachment-size', t('errors.common.attachmentTooLarge'));
    const bytes = new Uint8Array(await file.arrayBuffer()); const id = await sha256(bytes);
    await this.putAttachmentBytes(profileId, id, bytes);
    return { id, size: file.size, name: file.name || 'attachment', mediaType: file.type || 'application/octet-stream' };
  }
  putAttachmentBytes(profileId, id, bytes) {
    this.#check(profileId); return this.#queue(() => this.#write([], [], [{ id, bytes }]));
  }
  getAttachment(profileId, id) { this.#check(profileId); return this.#store.getAttachment(profileId, id); }
  journal() { return this.#legacy.journal(); }
  async reset(profileId) { this.#check(profileId); await this.#legacy?.reset(profileId); await this.#store.reset?.(profileId); }
  close() { this.#store.close?.(); this.#legacy?.close(); }
}
