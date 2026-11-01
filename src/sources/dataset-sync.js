import { copy, FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { revisionRecord } from './revisions.js';
import { DATASET_LIMITS, DATASET_SHARDS, datasetFile, datasetRecord, encodeDatasetRecord, validateDatasetFile, verifyDatasetBytes } from './dataset-codec.js';
import { DatasetLifecycle } from './dataset-lifecycle.js';
import { DatasetProtocol, listDatasetObjects, mergeDatasetInputs } from './dataset-protocol.js';
import { purgeJobKey } from './dataset-purge.js';
import { t } from '../i18n/index.js';

const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const changed = condition => requireValue(condition, 'dataset-changed', t('errors.sources.datasetChanged'));
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
const capacity = condition => requireValue(condition, 'dataset-busy', t('errors.sources.datasetBusy'));
const publicationKey = (dataset, operation) => `upload:${dataset}:${operation}`;

/** Account-bound current sync. Retained history never participates in discovery, admission or normal refresh. */
export class DatasetSync {
  #workspace; #storage; #store; #protocol; #lifecycle; #session; #binding; #latest;
  #running = null; #closed = false; #abort = new AbortController(); #now; #random; #failures = 0;
  #tailSizes = new Map();
  #status = { phase: 'idle', pending: 0, nextAttemptAt: 0, error: null };
  constructor({ workspace, storage, fileStore, now = Date.now, random = Math.random }) {
    requireValue(workspace.currentFormat && typeof fileStore.sourceId === 'string', 'invalid-source', t('errors.sources.sourceIdRequired'));
    this.#workspace = workspace; this.#storage = storage; this.#now = now; this.#random = random;
    this.#store = new Proxy(fileStore, { get: (target, key) => typeof target[key] !== 'function' ? target[key] : async (input = {}) => {
      this.#check(); const result = await target[key]({ ...input, signal: this.#abort.signal }); this.#check(); return result;
    } });
    this.#protocol = new DatasetProtocol(this.#store, storage); this.#lifecycle = new DatasetLifecycle(this.#store, storage);
  }
  get status() { return copy(this.#status); }
  get binding() { return copy(this.#binding ?? this.#workspace.syncState.dataset ?? null); }
  #check() {
    requireValue(!this.#closed && this.#session, 'stale-session', t('errors.sources.sessionEnded'));
    this.#workspace.assertSyncSession(this.#session);
  }
  async stop({ endSession = true } = {}) {
    this.#closed = true; this.#abort.abort();
    if (this.#session && endSession) try { await this.#workspace.endSync(this.#session); }
    catch (error) { if (error.code !== 'stale-session') throw error; }
    this.#status.phase = 'stopped';
  }
  async whenIdle() { await this.#running?.catch(() => {}); }
  sync({ force = false } = {}) {
    if (this.#running) return this.#running;
    if (this.#closed) return Promise.reject(new FleetError('stale-session', t('errors.sources.sessionEnded')));
    if (!force && this.#now() < this.#status.nextAttemptAt) return Promise.reject(new FleetError('sync-backoff', t('errors.sources.backoff')));
    this.#running = this.#run().finally(() => { this.#running = null; }); return this.#running;
  }
  async #run() {
    this.#status = { phase: 'syncing', pending: this.#workspace.pendingCount, nextAttemptAt: 0, error: null };
    try {
      this.#session ??= await this.#workspace.beginSync(this.#store.sourceId); this.#check();
      const reset = await this.#storage.getJob('dataset-reset');
      requireValue(!reset || reset.phase === 'complete', 'source-reset-pending', t('errors.sources.resetPending'));
      const known = this.#workspace.syncState.dataset;
      if (known) {
        await this.#protocol.assertGeneration(known.descriptor, known.plan, this.#abort.signal); this.#binding = known;
      } else {
        const pending = await this.#storage.getJob('dataset-initialize');
        if (pending) this.#binding = await this.#lifecycle.initialize({ starter: true, signal: this.#abort.signal });
        else {
          const found = await this.#lifecycle.inspect(this.#abort.signal);
          if (found.phase === 'preparing') { this.#status.phase = 'waiting-initialization'; return this.status; }
          requireValue(found.phase !== 'conflict', 'initialization-conflict', t('errors.sources.initializationConflict'));
          requireValue(found.phase !== 'incompatible', 'incompatible-cloud-data', t('errors.sources.incompatibleCloudData'));
          this.#binding = found.binding ?? await this.#lifecycle.initialize({ starter: this.#workspace.state.groups.length === 0, signal: this.#abort.signal });
        }
        // A second prepare appearing during our initialization is a conflict, including before either is ready.
        const discovery = await this.#lifecycle.inspect(this.#abort.signal);
        requireValue(discovery.phase === 'ready' && discovery.binding.plan.datasetId === this.#binding.plan.datasetId,
          'initialization-conflict', t('errors.sources.initializationConflict'));
      }
      await this.#pull();
      await this.#storage.deleteJob('dataset-initialize');
      // A pass is bounded even after months offline; the UI stays usable and schedules another pass.
      const page = await this.#storage.pendingPage({ limit: 32 });
      for (const operation of page.operations) {
        this.#check();
        try { await this.#push(operation); }
        catch (error) {
          if (error.code !== 'dataset-purged') throw error;
          await this.#pull();
          await this.#workspace.acknowledgeOperations(this.#session, [operation.operationId],
            { jobs: [publicationKey(this.#binding.plan.datasetId, operation.operationId)] });
        }
      }
      await this.#pull();
      if (this.#latest.complete && !this.#workspace.pendingCount) await this.#workspace.completeSync(this.#session, new Date(this.#now()).toISOString());
      this.#failures = 0;
      this.#status = { phase: this.#latest.complete ? 'idle' : 'syncing', pending: this.#workspace.pendingCount, nextAttemptAt: 0, error: null };
      return this.status;
    } catch (error) {
      const retryable = ['network', 'rate-limit', 'service-unavailable', 'page-expired', 'upload-session-expired', 'dataset-busy', 'file-missing', 'source-file-missing'].includes(error.code);
      const delay = retryable ? Math.max(Math.min(60000, 1000 * 2 ** Math.min(this.#failures++, 6)) * (0.5 + this.#random() * 0.5), error.details?.retryAfterMs ?? 0) : 0;
      this.#status = { phase: this.#closed ? 'stopped' : error.code === 'unauthorized' ? 'needs-login' : retryable ? 'backoff' : 'needs-attention',
        pending: this.#workspace.pendingCount, nextAttemptAt: retryable ? this.#now() + delay : 0,
        error: { code: error.code ?? 'storage-error', message: error.message } };
      throw error;
    }
  }

  async #pull() {
    const { descriptor, plan } = this.#binding, state = this.#workspace.state;
    let result, previous = state.sync.datasetView, shards = new Map(), cursor = state.sync.cursor;
    if (previous) for (const shard of DATASET_SHARDS) {
      const value = await this.#storage.getControl(previous[shard]); if (!value) { cursor = null; break; } shards.set(shard, value);
    }
    const published = [...shards.values()].flatMap(value => value.heads.map(head => head.record)), dataEntities = new Set();
    const changedShards = new Set();
    if (cursor && shards.size === DATASET_SHARDS.length) {
      await this.#protocol.assertGeneration(descriptor, plan, this.#abort.signal);
      const known = new Map([...shards].flatMap(([shard, value]) => value.inputs.map(file => [file.id, shard])));
      const purged = new Set(), seen = new Set(); let events = 0, bytes = 0, complete = false;
      try {
        do {
          invalid(!seen.has(cursor)); seen.add(cursor);
          const page = await this.#store.listDatasetChanges({ cursor });
          invalid(Array.isArray(page.changes) && page.changes.length <= 100 && Boolean(page.nextCursor) !== Boolean(page.cursor));
          events += page.changes.length; bytes += new TextEncoder().encode(canonicalJson(page)).length;
          for (const change of page.changes) {
            if (change.removed) {
              changed(![plan.rootId, plan.readyId, descriptor.id, plan.fenceId].includes(change.id));
              if (known.has(change.id)) changedShards.add(known.get(change.id));
            } else {
              changed(!change.legacyReset && !(change.file?.kind === 'dataset' && change.file.datasetId !== plan.datasetId));
              if (change.file?.datasetId !== plan.datasetId) continue;
              if (['change', 'checkpoint'].includes(change.file.kind)) changedShards.add(change.file.shard);
              if (['revision', 'attachment'].includes(change.file.kind) && change.file.shard !== 'groups') dataEntities.add(change.file.entityId);
              if (change.file.kind === 'purge') { purged.add(change.file.entityId); changedShards.add(change.file.shard); }
            }
          }
          cursor = page.nextCursor ?? page.cursor;
          if (!page.nextCursor) { complete = true; break; }
          if (events >= DATASET_LIMITS.feedEvents || bytes >= DATASET_LIMITS.feedBytes) break;
        } while (true);
        for (const shard of changedShards) {
          let inputs;
          try { inputs = await this.#protocol.captureShard(plan, shard, this.#abort.signal); }
          catch (error) { if (!missing(error)) throw error; inputs = await this.#protocol.captureShard(plan, shard, this.#abort.signal); }
          shards.set(shard, { heads: mergeDatasetInputs(inputs), inputs: inputs.map(input => input.file) });
        }
        const targets = [...purged, ...dataEntities, ...[...changedShards].flatMap(shard => shards.get(shard).heads.filter(head => head.record.kind === 'card').map(head => head.record.entityId)),
          ...state.revisions.filter(record => record.kind === 'card' && state.sync.localHeads?.includes(record.revisionId)).map(record => record.entityId),
          ...Object.values(state.drafts).map(draft => draft.cardId)];
        result = { heads: [...shards.values()].flatMap(value => value.heads), inputs: [...shards.values()].flatMap(value => value.inputs),
          purges: await this.#protocol.purges(plan, targets, this.#abort.signal), cursor: complete ? cursor : null, complete };
      } catch (error) { if (error.code !== 'cursor-expired') throw error; }
    }
    if (!result) {
      result = await this.#protocol.reconcile(descriptor, plan, { signal: this.#abort.signal,
        localEntities: [...state.cards.map(card => card.id), ...Object.values(state.drafts).map(draft => draft.cardId)] });
      for (const shard of DATASET_SHARDS) {
        changedShards.add(shard); shards.set(shard, { heads: result.heads.filter(head => head.file.shard === shard), inputs: result.inputs.filter(file => file.shard === shard) });
      }
    }
    await this.#protocol.assertGeneration(descriptor, plan, this.#abort.signal);
    const forbidden = new Set(result.purges.map(value => value.entityId));
    const dirty = new Set([...(result.dirtyEntities ?? []), ...result.heads.filter(head => head.record.kind === 'card' && forbidden.has(head.record.entityId)).map(head => head.record.entityId),
      ...[...dataEntities].filter(id => forbidden.has(id))]);
    for (const purge of result.purges) {
      await this.#storage.putControl(`purge:${plan.datasetId}:${purge.entityId}`, purge);
      const key = purgeJobKey(plan.datasetId, purge.entityId);
      if (!await this.#storage.getJob(key) && (dirty.has(purge.entityId) || !await this.#storage.getControl(`purge-cleaned:${plan.datasetId}:${purge.entityId}`))) {
        await this.#storage.putJob(key, { kind: 'dataset-purge', profileId: state.profileId, binding: this.#binding, phase: 'committed',
          item: { operationId: purge.operationId, entityId: purge.entityId, trashEpisode: purge.trashEpisode,
            heads: purge.heads, remoteHeads: [], folderIds: purge.folderIds } });
      }
    }
    result.heads = result.heads.filter(head => head.record.kind !== 'card' || !forbidden.has(head.record.entityId));
    const view = { ...previous }, controls = [];
    for (const [shard, value] of shards) {
      const heads = value.heads.filter(head => head.record.kind !== 'card' || !forbidden.has(head.record.entityId));
      if (!changedShards.has(shard) && heads.length === value.heads.length) continue;
      const key = `view:${plan.datasetId}:${crypto.randomUUID()}:${shard}`;
      controls.push({ key, value: { heads, inputs: value.inputs } }); view[shard] = key;
    }
    this.#check(); result.view = view; result.controls = controls; result.published = published;
    await this.#workspace.receiveDataset(this.#session, this.#binding, result); this.#latest = result;
  }

  async #admit(incomingBytes) {
    const { descriptor, plan } = this.#binding;
    // Refresh the metadata admission boundary before each publication, not once for an arbitrarily large queue.
    let files = await listDatasetObjects(this.#store, { scope: 'current-all', datasetId: plan.datasetId },
      { signal: this.#abort.signal, limit: DATASET_SHARDS.length * 16 + DATASET_LIMITS.tailHard + DATASET_LIMITS.writers });
    const tail = files.filter(file => file.kind === 'change');
    const sizes = async rows => {
      const ids = new Set(rows.map(file => file.id));
      for (const id of this.#tailSizes.keys()) if (!ids.has(id)) this.#tailSizes.delete(id);
      for (const file of rows) if (!this.#tailSizes.has(file.id)) {
        const value = await this.#protocol.read(file, this.#abort.signal); this.#tailSizes.set(file.id, value.revision.size + file.size);
      }
      return rows.reduce((sum, file) => sum + this.#tailSizes.get(file.id), 0);
    };
    const tailBytes = await sizes(tail);
    const candidates = new Map(DATASET_SHARDS.map(shard => [shard, files.filter(file => file.kind === 'checkpoint' && file.shard === shard).length]));
    const pending = await this.#storage.getJob(`checkpoint:${plan.datasetId}`);
    if (pending || tail.length >= DATASET_LIMITS.tailSoft || tailBytes + incomingBytes > 4 * 1024 * 1024
      || [...candidates.values()].some(count => count >= DATASET_LIMITS.candidates)) {
      const shard = pending?.file.shard ?? [...DATASET_SHARDS].sort((a, b) =>
        (candidates.get(b) >= DATASET_LIMITS.candidates ? 1e12 : 0) - (candidates.get(a) >= DATASET_LIMITS.candidates ? 1e12 : 0)
        || files.filter(file => file.shard === b).reduce((sum, file) => sum + (this.#tailSizes.get(file.id) ?? 1), 0)
        - files.filter(file => file.shard === a).reduce((sum, file) => sum + (this.#tailSizes.get(file.id) ?? 1), 0))[0];
      const inputs = await this.#protocol.captureShard(plan, shard, this.#abort.signal);
      const successor = await this.#protocol.checkpoint(plan, shard, inputs, this.#abort.signal);
      capacity(await this.#protocol.retire(descriptor, plan, successor, this.#abort.signal));
      files = await listDatasetObjects(this.#store, { scope: 'current-all', datasetId: plan.datasetId },
        { signal: this.#abort.signal, limit: DATASET_SHARDS.length * 16 + DATASET_LIMITS.tailHard + DATASET_LIMITS.writers });
    }
    capacity(files.filter(file => file.kind === 'change').length < DATASET_LIMITS.tailHard
      && await sizes(files.filter(file => file.kind === 'change')) + incomingBytes <= DATASET_LIMITS.checkpointBytes
      && DATASET_SHARDS.every(shard => files.filter(file => file.kind === 'checkpoint' && file.shard === shard).length < DATASET_LIMITS.candidates));
  }

  async #barrier(entityId, kind) {
    const { descriptor, plan } = this.#binding;
    await this.#protocol.assertGeneration(descriptor, plan, this.#abort.signal);
    if (kind === 'card') {
      const purges = await this.#protocol.purges(plan, [entityId], this.#abort.signal);
      for (const purge of purges) await this.#storage.putControl(`purge:${plan.datasetId}:${entityId}`, purge);
      requireValue(!purges.length && !await this.#storage.getControl(`purge:${plan.datasetId}:${entityId}`), 'dataset-purged', t('errors.sources.datasetPurged'));
    }
  }

  async #push(operation) {
    const { plan } = this.#binding, key = publicationKey(plan.datasetId, operation.operationId);
    await this.#barrier(operation.entityId, operation.kind);
    let job = await this.#storage.getJob(key);
    if (!job) {
      const folderKey = `folder:${plan.datasetId}:${operation.kind}:${operation.entityId}`;
      let folder = await this.#storage.getControl(folderKey);
      if (!folder) {
        const existing = await listDatasetObjects(this.#store, { scope: 'entity-folders', datasetId: plan.datasetId, entities: [operation.entityId] }, { limit: 32, signal: this.#abort.signal });
        const parentId = plan.folders[operation.kind === 'card' ? 'notes' : 'groups'];
        for (const file of existing) invalid(file.parentId === parentId && file.role === (operation.kind === 'card' ? 'note' : 'group'));
        folder = existing.sort((a, b) => a.id.localeCompare(b.id))[0] ?? { id: await this.#store.allocateFileId(), kind: 'folder',
          datasetId: plan.datasetId, parentId, role: operation.kind === 'card' ? 'note' : 'group', entityId: operation.entityId };
        await this.#storage.putControl(folderKey, { ...folder, reserved: !existing.length });
        folder = { ...folder, reserved: !existing.length };
      }
      const { reserved = false, ...directory } = folder; validateDatasetFile(directory);
      const attachments = [];
      for (const attachment of operation.value.content?.attachments ?? []) {
        if (attachments.some(file => file.sha256 === attachment.id)) continue;
        const fileKey = `attachment:${plan.datasetId}:${operation.entityId}:${attachment.id}`;
        let file = await this.#storage.getControl(fileKey);
        if (!file) {
          file = validateDatasetFile({ id: await this.#store.allocateFileId(), kind: 'attachment', datasetId: plan.datasetId,
            parentId: directory.id, entityId: operation.entityId, sha256: attachment.id, size: attachment.size });
          await this.#storage.putControl(fileKey, file);
        }
        invalid(file.parentId === directory.id); attachments.push(file);
      }
      const record = revisionRecord(operation.kind, operation.value, operation.parents);
      const value = datasetRecord(plan.datasetId, 'revision', { record, attachments });
      const revision = await datasetFile(await this.#store.allocateFileId(), directory.id, value);
      const receipt = datasetRecord(plan.datasetId, 'change', { revision: revision.file });
      const change = await datasetFile(await this.#store.allocateFileId(), plan.folders.shards[revision.file.shard], receipt);
      job = { kind: 'dataset-upload', operation, folder: directory, newFolder: reserved, attachments, revision: { file: revision.file, value },
        change: { file: change.file, value: receipt }, phase: 'reserved' };
      await this.#storage.putJob(key, job);
    }
    invalid(job.kind === 'dataset-upload' && equal(job.operation, operation) && job.folder.datasetId === plan.datasetId);
    await this.#admit(job.revision.file.size + job.change.file.size);
    try { invalid(equal(await this.#store.getObject({ id: job.folder.id }), job.folder)); }
    catch (error) {
      if (!missing(error)) throw error;
      changed(job.newFolder && job.phase === 'reserved');
      await this.#barrier(operation.entityId, operation.kind);
      try { await this.#store.createFolder({ file: job.folder }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      invalid(equal(await this.#store.getObject({ id: job.folder.id }), job.folder));
    }
    if (job.phase === 'reserved') {
      await this.#storage.putControl(`folder:${plan.datasetId}:${operation.kind}:${operation.entityId}`, { ...job.folder, reserved: false });
      job = { ...job, phase: 'body' }; await this.#storage.putJob(key, job);
    }
    for (const file of job.attachments) {
      let present = false;
      try { invalid(equal(await this.#store.getObject({ id: file.id }), file)); present = true; }
      catch (error) { if (!missing(error)) throw error; }
      if (present) continue;
      const blob = await this.#storage.getAttachment(this.#session.profileId, file.sha256);
      requireValue(blob instanceof Blob, 'missing-attachment', t('errors.sources.attachmentMissing'));
      const bytes = new Uint8Array(await blob.arrayBuffer()); await verifyDatasetBytes(file, bytes);
      await this.#barrier(operation.entityId, operation.kind);
      try { await this.#store.createObject({ file, bytes }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      await verifyDatasetBytes(file, await this.#store.readObject({ file }));
    }
    const publish = async item => {
      try { invalid(equal(await this.#protocol.read(item.file, this.#abort.signal), item.value)); return; }
      catch (error) { if (!missing(error)) throw error; }
      await this.#barrier(operation.entityId, operation.kind);
      try { await this.#store.createObject({ file: item.file, bytes: encodeDatasetRecord(item.value) }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      invalid(equal(await this.#protocol.read(item.file, this.#abort.signal), item.value));
    };
    await publish(job.revision);
    // A receipt can already have been consumed by a checkpoint after a lost reply. Reconcile first; a late replay
    // is only allowed as a conservative branch when coverage can no longer be proved from the bounded current set.
    if (job.phase === 'receipt') {
      await this.#pull();
      const covered = this.#latest.heads.some(head => head.record.revisionId === operation.operationId)
        || this.#latest.heads.some(head => head.record.parents.includes(operation.operationId));
      if (covered) {
        await this.#barrier(operation.entityId, operation.kind);
        await this.#workspace.acknowledgeOperations(this.#session, [operation.operationId], { jobs: [key] }); return;
      }
    } else { job = { ...job, phase: 'receipt' }; await this.#storage.putJob(key, job); }
    await publish(job.change); await this.#barrier(operation.entityId, operation.kind);
    await this.#workspace.acknowledgeOperations(this.#session, [operation.operationId], { jobs: [key] });
  }
}
