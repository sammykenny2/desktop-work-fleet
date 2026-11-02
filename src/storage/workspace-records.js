import { copy, requireValue } from '../core/contracts.js';
import { CURRENT_WORKSPACE_FORMAT } from '../core/workspace.js';
import { canonicalJson } from '../sources/json.js';
import { sha256, validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';
import { RECORD_LIMITS, recordTransaction } from './records.js';

const omitted = new Set(['revision', 'groups', 'cards', 'revisions', 'drafts', 'outbox', 'conflicts']);
const equal = (a, b) => a === b || (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b));
const stale = condition => requireValue(condition, 'stale-writer', t('errors.storage.staleWriter'));
const encoder = new TextEncoder();

/** Current state is a small independently loadable view. History and pending uploads are indexed records. */
export class WorkspaceRecordStorage {
  #store; #legacy; #profile; #receipt = null; #active = null; #tail = Promise.resolve(); #attachmentLoader = null;
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
  async #write(puts, deletes = [], attachments = [], attachmentDeletes = []) {
    const expected = this.#receipt?.revision ?? null;
    const transaction = recordTransaction(this.#profile, expected,
      puts.map(row => ({ ...row, ordinal: row.collection === 'outbox' ? row.ordinal : (expected ?? -1) + 1 })), deletes, undefined, attachmentDeletes);
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
  #owners(kind, id, content, generation = this.#historyGeneration()) {
    return [...new Set((content?.attachments ?? []).map(file => file.id))].flatMap(digest => [
      this.#row('control', `owner:${kind}:${id}:${digest}`, { attachmentId: digest }, `${generation}:owners:${kind}:${id}`, generation),
      this.#row('control', `ref:${kind}:${id}:${digest}`, {}, `attachment:${digest}`, generation),
    ]);
  }
  #unique(rows) { return [...new Map(rows.map(row => [`${row.collection}:${row.key}`, row])).values()]; }
  #viewGarbage(previous, state) {
    const active = new Set(Object.values(state.sync.datasetView ?? {}));
    return Object.values(previous?.sync.datasetView ?? {}).filter(key => !active.has(key)).map(key => ({ collection: 'job',
      key: `gc:${key}`, entity: 'view-gc', ordinal: 0, value: { key } }));
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
  saveWithAttachments(state, expectedRevision, attachments, detail = {}) {
    return this.#queue(() => this.#save(state, expectedRevision, { ...detail, attachments }));
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
    for (const [id, draft] of Object.entries(state.drafts)) if (!equal(draft, previous.drafts[id])) {
      const known = new Set((previous.drafts[id]?.content.attachments ?? []).map(file => file.id));
      puts.push(this.#row('draft', id, draft), ...this.#owners('draft', id, draft.content).filter(row => !known.has(row.key.split(':').at(-1))));
    }
    for (const id of Object.keys(previous.drafts)) if (!Object.hasOwn(state.drafts, id)) deletes.push({ collection: 'draft', key: this.#key(id) });
    for (const [id, draft] of Object.entries(previous.drafts)) {
      const kept = new Set((state.drafts[id]?.content.attachments ?? []).map(file => file.id));
      for (const row of this.#owners('draft', id, draft.content)) if (!kept.has(row.key.split(':').at(-1))) {
        deletes.push({ collection: row.collection, key: row.key });
        const digest = row.key.split(':').at(-1);
        puts.push({ collection: 'job', key: `attachment-gc:${digest}`, entity: 'attachment-gc', ordinal: 0, value: { id: digest } });
      }
    }
    for (const record of detail.additions ?? []) puts.push(this.#row('history', record.revisionId, record,
      this.#key(`${record.kind}:${record.entityId}`, this.#historyGeneration()), this.#historyGeneration()));
    for (const record of detail.additions ?? []) {
      const known = new Set(previous.revisions.filter(old => old.entityId === record.entityId && old.kind === record.kind)
        .flatMap(old => (old.value.content?.attachments ?? []).map(file => file.id)));
      puts.push(...this.#owners(record.kind, record.entityId, record.value.content).filter(row => !known.has(row.key.split(':').at(-1))));
    }
    puts.push(...this.#viewGarbage(previous, state));
    for (const { key, value } of detail.controls ?? []) puts.push({ collection: 'control', key, entity: '', ordinal: 0, value });
    for (const operation of detail.pending ?? []) puts.push(this.#row('outbox', operation.operationId, operation),
      this.#row('control', `pending:${operation.operationId}`, {}, this.#key(`pending:${operation.kind}:${operation.entityId}`)));
    for (const id of detail.removedOperations ?? []) {
      const row = await this.#store.get(this.#profile, 'outbox', this.#key(id)); stale(row !== null);
      if (detail.purgeEntity) stale(row.value.kind === 'card' && row.value.entityId === detail.purgeEntity
        && await this.getControl(`local-purge:${detail.purgeEntity}`) !== null);
      deletes.push({ collection: 'outbox', key: this.#key(id) }, { collection: 'control', key: this.#key(`pending:${id}`) });
    }
    for (const key of detail.removedJobs ?? []) deletes.push({ collection: 'job', key });
    const active = { ...this.#active, revision: state.revision };
    puts.push({ collection: 'meta', key: 'active', entity: '', ordinal: 0, value: active });
    const uniquePuts = this.#unique(puts);
    if (uniquePuts.length + deletes.length > RECORD_LIMITS.rows
      || encoder.encode(canonicalJson({ puts, deletes })).length > RECORD_LIMITS.transactionBytes - 2048) return this.#stage(state, detail);
    await this.#write(uniquePuts, deletes, detail.attachments); this.#active = active;
  }
  /** Bulk replacement builds an isolated generation; a single pointer publishes it after every chunk is durable. */
  async #stage(state, detail) {
    const generation = crypto.randomUUID();
    const keepHistory = Boolean(this.#active && !detail.replaceGeneration);
    const historyGeneration = keepHistory ? this.#historyGeneration() : generation;
    const oldPending = keepHistory ? (await this.#rows('outbox', this.#active.generation, this.#receipt.revision))
      .filter(row => !detail.removedOperations?.includes(row.value.operationId)) : [];
    const stageKey = `local-generation:${generation}`;
    await this.#write([{ collection: 'job', key: stageKey, entity: 'local-generation', ordinal: 0,
      value: { generation, historyGeneration: keepHistory ? null : generation, phase: 0, after: null,
        viewKeys: (detail.controls ?? []).filter(item => item.key.startsWith('view:')).map(item => item.key) } }]);
    const row = (collection, id, value, entity = generation) => this.#row(collection, id, value, entity, generation);
    const rows = Object.entries(state).filter(([key]) => !omitted.has(key)).map(([key, value]) => row('meta', key, value));
    rows.push(...state.revisions.map(record => row('current', record.revisionId, record)),
      ...Object.values(state.drafts).map(draft => row('draft', draft.id, draft)),
      ...(detail.history ?? detail.additions ?? (keepHistory ? [] : state.revisions)).map(record => this.#row('history', record.revisionId, record,
        `${historyGeneration}:${record.kind}:${record.entityId}`, historyGeneration)),
      ...oldPending.map(item => ({ ...row('outbox', item.value.operationId, item.value), ordinal: item.ordinal })),
      ...(detail.pending ?? []).map(operation => row('outbox', operation.operationId, operation)));
    for (const operation of [...oldPending.map(row => row.value), ...(detail.pending ?? [])]) rows.push(
      row('control', `pending:${operation.operationId}`, {}, `${generation}:pending:${operation.kind}:${operation.entityId}`));
    const history = detail.history ?? detail.additions ?? (keepHistory ? [] : state.revisions);
    for (const record of history) rows.push(...this.#owners(record.kind, record.entityId, record.value.content, historyGeneration));
    for (const draft of Object.values(state.drafts)) rows.push(...this.#owners('draft', draft.id, draft.content, historyGeneration));
    for (const { key, value } of detail.controls ?? []) rows.push({ collection: 'control', key, entity: '', ordinal: 0, value });
    let chunk = [], bytes = 1024;
    for (const item of this.#unique(rows)) {
      const size = encoder.encode(canonicalJson(item)).length + 1;
      if (chunk.length && (chunk.length >= 400 || bytes + size > RECORD_LIMITS.transactionBytes - 1024)) {
        await this.#write(chunk); chunk = []; bytes = 1024;
      }
      chunk.push(item); bytes += size;
    }
    if (chunk.length) await this.#write(chunk);
    for (const attachment of detail.attachments ?? []) await this.#write([], [], [attachment]);
    const active = { generation, historyGeneration, revision: state.revision };
    const final = [{ collection: 'meta', key: 'active', entity: '', ordinal: 0, value: active }];
    final.push(...this.#viewGarbage(detail.previous, state));
    if (this.#active) final.push({ collection: 'job', key: `local-generation:${this.#active.generation}`, entity: 'local-generation', ordinal: 0,
      value: { generation: this.#active.generation, historyGeneration: keepHistory ? null : this.#historyGeneration(), phase: 0, after: null } });
    await this.#write(final, [{ collection: 'job', key: stageKey }, ...(detail.removedJobs ?? []).map(key => ({ collection: 'job', key }))]);
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
  async purgedEntities(ids, { remote = true } = {}) {
    requireValue(!remote || !this.#profile.startsWith('google:'), 'history-offline', t('errors.sources.historyOffline'));
    const found = [];
    for (const id of new Set(ids)) if (await this.getControl(`local-purge:${id}`)) found.push(id);
    return found.sort();
  }
  async verifySnapshot(state, options) {
    stale(state.profileId === this.#profile && state.revision === this.#active.revision);
    requireValue(!(await this.purgedEntities(state.cards.map(card => card.id), options)).length,
      'dataset-purged', t('errors.sources.datasetPurged'));
  }
  async #control(collection, key) { return (await this.#store.get(this.#profile, collection, key))?.value ?? null; }
  #putControl(collection, key, value) {
    return this.#queue(async () => {
      this.#receipt ??= await this.#status();
      await this.#write([{ collection, key, entity: collection === 'job' ? value.kind ?? '' : '', ordinal: 0, value: copy(value) }]);
    });
  }
  #deleteControl(collection, key) { return this.#queue(() => this.#write([], [{ collection, key }])); }
  getJob(key) { return this.#control('job', key); }
  putJob(key, value) { return this.#putControl('job', key, value); }
  putJobs(values) {
    return this.#queue(async () => {
      this.#receipt ??= await this.#status();
      for (let index = 0; index < values.length; index += 100) await this.#write(values.slice(index, index + 100).map(({ key, value }) =>
        ({ collection: 'job', key, entity: value.kind ?? '', ordinal: 0, value })));
    });
  }
  deleteJob(key) { return this.#deleteControl('job', key); }
  async jobs(kind, { after = null, limit = 20 } = {}) {
    const status = await this.#status();
    return this.#store.page(this.#profile, { collection: 'job', entity: kind, after, limit, expectedRevision: status.revision });
  }
  getControl(key) { return this.#control('control', key); }
  putControl(key, value) { return this.#putControl('control', key, value); }
  putControls(values) {
    return this.#queue(() => this.#write(values.map(({ key, value }) => ({ collection: 'control', key, entity: '', ordinal: 0, value }))));
  }
  deleteControl(key) { return this.#deleteControl('control', key); }
  cacheHistory(records) {
    return this.#queue(() => this.#write(this.#unique(records.flatMap(record => [this.#row('history', record.revisionId, record,
      this.#key(`${record.kind}:${record.entityId}`, this.#historyGeneration()), this.#historyGeneration()),
      ...this.#owners(record.kind, record.entityId, record.value.content)]))));
  }
  /** At most one indexed metadata page per call. The caller yields to foreground edits between calls. */
  cleanupHistory(kind, entityId) {
    return this.#queue(async () => {
      const page = await this.#store.page(this.#profile, { collection: 'history', entity: this.#key(`${kind}:${entityId}`, this.#historyGeneration()),
        keysOnly: true, limit: 100, expectedRevision: this.#receipt.revision });
      if (page.rows.length) { await this.#write([], page.rows.map(({ collection, key }) => ({ collection, key }))); return false; }
      return this.#cleanupOwners(kind, entityId, this.#historyGeneration());
    });
  }
  async #cleanupOwners(kind, entityId, generation) {
    const page = await this.#store.page(this.#profile, { collection: 'control', entity: `${generation}:owners:${kind}:${entityId}`,
      keysOnly: true, limit: 100, expectedRevision: this.#receipt.revision });
    if (!page.rows.length) return true;
    const deletes = [], jobs = [];
    for (const row of page.rows) {
      const digest = row.key.split(':').at(-1);
      deletes.push({ collection: 'control', key: row.key }, { collection: 'control', key: `${generation}:ref:${kind}:${entityId}:${digest}` });
      jobs.push({ collection: 'job', key: `attachment-gc:${digest}`, entity: 'attachment-gc', ordinal: 0, value: { id: digest } });
    }
    await this.#write(jobs, deletes); return false;
  }
  maintenance() {
    return this.#queue(async () => {
      const jobs = await this.#store.page(this.#profile, { collection: 'job', entity: 'local-generation', limit: 1, expectedRevision: this.#receipt.revision });
      if (jobs.rows.length) {
        const row = jobs.rows[0], job = row.value;
        if (job.generation === this.#active.generation) { await this.#write([], [{ collection: 'job', key: row.key }]); return true; }
        const collections = ['current', 'draft', 'outbox', 'meta', ...(job.historyGeneration ? ['history'] : []), 'control'];
        const collection = collections[job.phase];
        const page = await this.#store.page(this.#profile, { collection, entity: job.phase < 4 ? job.generation : null,
          keysOnly: true, after: job.after, limit: 100, expectedRevision: this.#receipt.revision });
        const deletes = page.rows.filter(item => job.phase < 4 || item.key.startsWith(job.historyGeneration ? `${job.historyGeneration}:` : `${job.generation}:pending:`))
          .map(({ collection, key }) => ({ collection, key }));
        const garbage = this.#unique(deletes.filter(item => item.collection === 'control' && validDigest(item.key.split(':').at(-1))).map(item => {
          const id = item.key.split(':').at(-1); return { collection: 'job', key: `attachment-gc:${id}`, entity: 'attachment-gc', ordinal: 0, value: { id } };
        }));
        job.after = page.next;
        if (!page.next) { job.phase++; job.after = null; }
        if (job.phase === collections.length) {
          const sync = (await this.#store.get(this.#profile, 'meta', this.#key('sync')))?.value;
          const activeViews = new Set(Object.values(sync?.datasetView ?? {}));
          deletes.push({ collection: 'job', key: row.key }, ...(job.viewKeys ?? []).filter(key => !activeViews.has(key)).map(key => ({ collection: 'control', key })));
        }
        await this.#write([...garbage, ...(job.phase === collections.length ? [] : [{ ...row, value: job }])], deletes);
        return true;
      }
      const views = await this.#store.page(this.#profile, { collection: 'job', entity: 'view-gc', limit: 1, expectedRevision: this.#receipt.revision });
      if (views.rows.length) {
        const row = views.rows[0], sync = (await this.#store.get(this.#profile, 'meta', this.#key('sync')))?.value;
        const activeViews = new Set(Object.values(sync?.datasetView ?? {}));
        await this.#write([], [{ collection: 'job', key: row.key }, ...activeViews.has(row.value.key) ? [] : [{ collection: 'control', key: row.value.key }]]); return true;
      }
      const garbage = await this.#store.page(this.#profile, { collection: 'job', entity: 'attachment-gc', limit: 1, expectedRevision: this.#receipt.revision });
      if (!garbage.rows.length) return false;
      const row = garbage.rows[0], id = row.value.id;
      const references = await this.#store.page(this.#profile, { collection: 'control', entity: `attachment:${id}`, keysOnly: true,
        limit: 1, expectedRevision: this.#receipt.revision });
      await this.#write([], [{ collection: 'job', key: row.key }], [], references.rows.length ? [] : [id]); return true;
    });
  }
  async pendingPage({ after = null, limit = 50 } = {}) {
    const generation = this.#active.generation; stale(!after || after.generation === generation);
    const status = await this.#status();
    const result = await this.#store.page(this.#profile, { collection: 'outbox', entity: generation, after: after?.position ?? null,
      limit, order: 'asc', expectedRevision: status.revision });
    return { operations: result.rows.map(row => row.value), next: result.next ? { generation, position: result.next } : null };
  }
  async pendingForEntity(kind, entityId) {
    const status = await this.#status();
    const page = await this.#store.page(this.#profile, { collection: 'control', entity: this.#key(`pending:${kind}:${entityId}`),
      keysOnly: true, limit: 100, expectedRevision: status.revision });
    return page.rows.map(row => row.key.slice(`${this.#active.generation}:pending:`.length));
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
  setAttachmentLoader(loader) { this.#attachmentLoader = loader; }
  async getAttachment(profileId, id) { this.#check(profileId); return await this.#store.getAttachment(profileId, id) ?? this.#attachmentLoader?.(id) ?? null; }
  journal() { return this.#legacy.journal(); }
  async reset(profileId) { this.#check(profileId); await this.#legacy?.reset(profileId); await this.#store.reset?.(profileId); }
  close() { this.#store.close?.(); this.#legacy?.close(); }
}
