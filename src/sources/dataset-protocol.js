import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { CurrentRevisions } from './current-revisions.js';
import { DATASET_LIMITS, DATASET_SHARDS, datasetFile, datasetRecord, decodeDatasetRecord, encodeDatasetRecord,
  validateDatasetFile, validateDatasetRecord } from './dataset-codec.js';
import { t } from '../i18n/index.js';

const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const capacity = condition => requireValue(condition, 'dataset-busy', t('errors.sources.datasetBusy'));
const changed = condition => requireValue(condition, 'dataset-changed', t('errors.sources.datasetChanged'));
const missing = error => ['source-file-missing', 'file-missing'].includes(error.code);
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const reference = file => ({ id: file.id, sha256: file.sha256 });

export async function listDatasetObjects(store, query, { signal, limit = DATASET_LIMITS.inputs } = {}) {
  const files = []; const seen = new Set(); let pageToken = null;
  do {
    signal?.throwIfAborted();
    const page = await store.listObjects({ query, pageToken, signal });
    invalid(Array.isArray(page.files) && page.files.length <= 100 && !page.incomplete);
    for (const file of page.files) {
      if (query.scope !== 'fences' && query.scope !== 'legacy') validateDatasetFile(file);
      invalid(!files.some(previous => previous.id === file.id)); files.push(file); capacity(files.length <= limit);
    }
    pageToken = page.nextPageToken ?? null;
    invalid(pageToken === null || (typeof pageToken === 'string' && pageToken.length > 0 && pageToken.length <= 8192 && !seen.has(pageToken)));
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return files;
}

/** Coverage is exact and only applies to captured immutable inputs. No ancestry or timestamp winner is inferred. */
export function mergeDatasetInputs(inputs, purges = []) {
  capacity(inputs.length <= DATASET_LIMITS.inputs);
  const byId = new Map();
  for (const input of inputs) {
    invalid(!byId.has(input.file.id)); byId.set(input.file.id, input);
    validateDatasetFile(input.file); validateDatasetRecord(input.value);
    invalid(input.file.datasetId === input.value.datasetId && input.file.kind === input.value.kind
      && ['change', 'checkpoint'].includes(input.file.kind)
      && input.file.datasetId === inputs[0].file.datasetId && input.file.shard === inputs[0].file.shard);
  }
  const covered = new Set(), edges = new Map();
  for (const input of inputs) if (input.value.kind === 'checkpoint') {
    edges.set(input.file.id, []);
    for (const ref of input.value.inputs) {
      invalid(ref.id !== input.file.id);
      const previous = byId.get(ref.id);
      if (previous) {
        invalid(previous.file.sha256 === ref.sha256 && previous.file.datasetId === input.file.datasetId && previous.file.shard === input.file.shard);
        covered.add(ref.id); edges.get(input.file.id).push(ref.id);
      }
    }
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => {
    invalid(!visiting.has(id)); if (visited.has(id)) return;
    visiting.add(id); for (const parent of edges.get(id) ?? []) visit(parent);
    visiting.delete(id); visited.add(id);
  };
  for (const id of edges.keys()) visit(id);
  const barriers = [...purges];
  for (const input of inputs) if (input.purge) {
    validateDatasetRecord(input.purge);
    invalid(input.purge.kind === 'purge' && input.purge.datasetId === input.file.datasetId && input.purge.entityId === input.file.entityId);
    barriers.push(input.purge);
  }
  const forbidden = new Set(barriers.map(value => value.entityId)), locations = new Map(), records = [];
  for (const input of inputs) if (!covered.has(input.file.id)) {
    if (input.value.kind === 'change' && forbidden.has(input.file.entityId)) continue;
    const heads = input.value.kind === 'checkpoint' ? input.value.heads : [input.head];
    for (const head of heads) {
      invalid(head);
      if (head.record.kind === 'card' && forbidden.has(head.record.entityId)) continue;
      const previous = locations.get(head.record.revisionId);
      if (previous) invalid(equal(previous.record, head.record));
      if (!previous || head.file.id < previous.file.id) locations.set(head.record.revisionId, head);
      records.push(head.record);
    }
  }
  return new CurrentRevisions(records).records.map(record => copy(locations.get(record.revisionId)));
}

/** Provider-neutral protocol; it has no credentials, mutable latest pointer, lock lease or provider CAS. */
export class DatasetProtocol {
  #store; #journal;
  constructor(store, journal) { this.#store = store; this.#journal = journal; }
  get store() { return this.#store; }
  async read(file, signal) { return decodeDatasetRecord(file, await this.#store.readObject({ file, signal })); }
  async assertGeneration(descriptor, plan, signal) {
    validateDatasetRecord(plan); invalid(plan.kind === 'dataset' && descriptor.datasetId === plan.datasetId);
    try {
      const [root, actual, ready, fences, actualPlan, descriptors] = await Promise.all([
        this.#store.getObject({ id: plan.rootId, signal }), this.#store.getObject({ id: descriptor.id, signal }),
        this.#store.getObject({ id: plan.readyId, signal }), listDatasetObjects(this.#store, { scope: 'fences' }, { signal, limit: 16 }),
        this.read(descriptor, signal),
        listDatasetObjects(this.#store, { scope: 'datasets' }, { signal, limit: 16 }),
      ]);
      changed(descriptors.some(file => equal(file, descriptor)));
      for (const file of descriptors) if (file.datasetId !== plan.datasetId) {
        const other = await this.read(file, signal); changed(other.fenceId !== plan.fenceId);
      }
      changed(equal(actualPlan, plan) && descriptor.kind === 'dataset' && descriptor.parentId === plan.rootId
        && root.id === plan.rootId && root.kind === 'dataset-root' && root.datasetId === plan.datasetId && equal(actual, descriptor)
        && ready.kind === 'ready' && ready.datasetId === plan.datasetId && ready.parentId === plan.rootId
        && equal(fences.map(file => file.id).sort(), plan.fenceId ? [plan.fenceId] : []));
      const receipt = await this.read(ready, signal);
      changed(equal(receipt.descriptor, reference(descriptor)));
      for (const file of receipt.initial) invalid(file.parentId === plan.folders.shards[file.shard]);
      return receipt;
    } catch (error) { if (missing(error)) changed(false); throw error; }
  }
  async purges(plan, entityIds, signal) {
    const ids = [...new Set(entityIds)], result = [];
    for (let i = 0; i < ids.length; i += DATASET_LIMITS.queryEntities) {
      const batch = ids.slice(i, i + DATASET_LIMITS.queryEntities);
      const files = await listDatasetObjects(this.#store, { scope: 'purges', datasetId: plan.datasetId, entities: batch },
        { signal, limit: batch.length * DATASET_LIMITS.writers });
      for (const file of files) {
        invalid(file.datasetId === plan.datasetId && file.kind === 'purge' && batch.includes(file.entityId)
          && file.parentId === plan.folders.buckets[file.shard]);
        result.push(await this.read(file, signal));
      }
    }
    return result;
  }
  async captureShard(plan, shard, signal) {
    const files = await listDatasetObjects(this.#store, { scope: 'current', datasetId: plan.datasetId, shard }, { signal });
    capacity(files.filter(file => file.kind === 'checkpoint').length <= DATASET_LIMITS.candidates + DATASET_LIMITS.writers
      && files.filter(file => file.kind === 'change').length <= DATASET_LIMITS.tailHard + DATASET_LIMITS.writers - 1);
    const inputs = [];
    for (const file of files) {
      invalid(file.datasetId === plan.datasetId && file.shard === shard && file.parentId === plan.folders.shards[shard]);
      inputs.push({ file, value: await this.read(file, signal) });
    }
    const covered = new Set(inputs.flatMap(input => input.value.kind === 'checkpoint' ? input.value.inputs.map(ref => ref.id) : []));
    const purges = await this.purges(plan, inputs.filter(input => input.value.kind === 'change' && input.file.shard !== 'groups')
      .map(input => input.file.entityId), signal);
    let tailBytes = 0;
    for (const input of inputs) if (input.value.kind === 'change' && !covered.has(input.file.id)) {
      input.purge = purges.find(value => value.entityId === input.file.entityId);
      if (input.purge) continue;
      const file = input.value.revision; tailBytes += file.size + input.file.size;
      capacity(tailBytes <= DATASET_LIMITS.checkpointBytes * DATASET_LIMITS.writers);
      let value;
      try { value = await this.read(file, signal); }
      catch (error) {
        if (!missing(error) || file.shard === 'groups') throw error;
        [input.purge] = await this.purges(plan, [file.entityId], signal);
        if (input.purge) continue; throw error;
      }
      invalid(file.datasetId === plan.datasetId && file.shard === shard);
      input.head = { record: value.record, file, attachments: value.attachments };
    }
    // Validation also rejects cycles/false digests in coverage before anything may be retired.
    mergeDatasetInputs(inputs); return inputs;
  }
  /** The journal stores the exact output before create; retries reuse bytes and ID, including after lost replies. */
  async publish(key, parentId, value, signal) {
    let job = await this.#journal.getJob(key);
    if (job) invalid(job.kind === 'dataset-publication' && job.file.parentId === parentId && equal(job.value, value));
    else {
      const reserved = await datasetFile(await this.#store.allocateFileId({ signal }), parentId, value);
      job = { kind: 'dataset-publication', file: reserved.file, value: copy(value) };
      await this.#journal.putJob(key, job);
    }
    const bytes = encodeDatasetRecord(job.value);
    // Validate identity/attachment/shard bindings before uploading, as well as on read-back.
    await decodeDatasetRecord(job.file, bytes);
    try { await this.#store.createObject({ file: job.file, bytes, signal }); }
    catch (error) {
      if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error;
      const actual = await this.read(job.file, signal); invalid(equal(actual, job.value));
    }
    invalid(equal(await this.read(job.file, signal), job.value));
    return copy(job.file);
  }
  async checkpoint(plan, shard, inputs, signal) {
    // One unfinished checkpoint per client/dataset. A retry completes it before planning another output.
    const key = `checkpoint:${plan.datasetId}`;
    const pending = await this.#journal.getJob(key);
    let retained = [], replacePending = false;
    if (pending) {
      invalid(pending.kind === 'dataset-publication' && pending.value.kind === 'checkpoint' && pending.file.datasetId === plan.datasetId);
      await decodeDatasetRecord(pending.file, encodeDatasetRecord(pending.value));
      const barriers = await this.purges(plan, pending.value.heads.filter(head => head.record.kind === 'card').map(head => head.record.entityId), signal);
      let exists = false;
      try { invalid(equal(await this.read(pending.file, signal), pending.value)); exists = true; }
      catch (error) { if (!missing(error)) throw error; }
      if (exists && !barriers.length) return { file: copy(pending.file), value: copy(pending.value), key };
      // Reacquire this shard before deciding whether the reserved output was retired, never from a 404 alone.
      shard = pending.value.shard; inputs = await this.captureShard(plan, shard, signal);
      const covering = inputs.find(input => input.value.kind === 'checkpoint'
        && input.value.inputs.some(ref => ref.id === pending.file.id && ref.sha256 === pending.file.sha256));
      if (covering) {
        await this.#journal.deleteJob(key);
        return { file: covering.file, value: covering.value, key: null };
      }
      const unchanged = pending.value.inputs.every(ref => inputs.some(input => input.file.id === ref.id && input.file.sha256 === ref.sha256));
      if (!exists && unchanged && !barriers.length) {
        const file = await this.publish(key, pending.file.parentId, pending.value, signal);
        return { file, value: copy(pending.value), key };
      }
      // Unknown retirement ancestry preserves the journal's values as conservative branches. Purge still wins.
      // This replaces the journal atomically; it never uses the absent output as permission to delete its inputs.
      retained = pending.value.heads; replacePending = true;
    }
    for (const input of inputs) {
      await decodeDatasetRecord(input.file, encodeDatasetRecord(input.value));
      if (input.head) {
        invalid(equal(input.head.file, input.value.revision));
        await decodeDatasetRecord(input.head.file, encodeDatasetRecord(datasetRecord(plan.datasetId, 'revision', {
          record: input.head.record, attachments: input.head.attachments,
        })));
      }
    }
    const current = mergeDatasetInputs(inputs), locations = new Map();
    for (const head of [...retained, ...current]) locations.set(head.record.revisionId, head);
    const graph = new CurrentRevisions([...retained, ...current].map(head => head.record));
    const combined = graph.records.map(record => locations.get(record.revisionId));
    const ids = combined.filter(head => head.record.kind === 'card').map(head => head.record.entityId);
    const purges = await this.purges(plan, ids, signal);
    const forbidden = new Set(purges.map(value => value.entityId));
    const value = datasetRecord(plan.datasetId, 'checkpoint', { operationId: crypto.randomUUID(), shard,
      inputs: inputs.map(input => reference(input.file)), heads: combined.filter(head => head.record.kind !== 'card' || !forbidden.has(head.record.entityId)) });
    if (replacePending) {
      const reserved = await datasetFile(await this.#store.allocateFileId({ signal }), plan.folders.shards[shard], value);
      await this.#journal.putJob(key, { kind: 'dataset-publication', file: reserved.file, value });
    }
    const file = await this.publish(key, plan.folders.shards[shard], value, signal);
    return { file, value, key };
  }
  async retire(descriptor, plan, successor, signal) {
    await this.assertGeneration(descriptor, plan, signal);
    let value;
    try { value = await this.read(successor.file, signal); }
    catch (error) { if (missing(error)) return false; throw error; }
    invalid(equal(value, successor.value));
    // A newly arrived purge requires a sanitized successor before this client retires anything.
    const purges = await this.purges(plan, value.heads.filter(head => head.record.kind === 'card').map(head => head.record.entityId), signal);
    if (purges.length) return false;
    for (const ref of value.inputs) {
      signal?.throwIfAborted(); let file;
      try { file = await this.#store.getObject({ id: ref.id, signal }); }
      catch (error) { if (missing(error)) continue; throw error; }
      invalid(file.datasetId === plan.datasetId && file.parentId === successor.file.parentId
        && file.shard === value.shard && ['checkpoint', 'change'].includes(file.kind) && file.sha256 === ref.sha256);
      await this.#store.deleteFile({ id: file.id, signal });
    }
    if (successor.key && (await this.#journal.getJob(successor.key))?.file.id === successor.file.id) await this.#journal.deleteJob(successor.key);
    return true;
  }
  /** Capture before listing, then bounded feed catch-up. An incomplete pass never returns an advanced cursor. */
  async reconcile(descriptor, plan, { signal, localEntities = [] } = {}) {
    await this.assertGeneration(descriptor, plan, signal);
    let cursor = await this.#store.getStartCursor({ signal });
    const shards = new Map(); let requested = new Set(DATASET_SHARDS), events = 0, bytes = 0;
    const seenCursors = new Set(); let complete = false, residualLegacy = false;
    for (let pass = 0; pass < 3; pass++) {
      for (const shard of requested) {
        try { shards.set(shard, await this.captureShard(plan, shard, signal)); }
        catch (error) {
          if (!missing(error)) throw error;
          shards.set(shard, await this.captureShard(plan, shard, signal));
        }
      }
      const tail = [...shards.values()].flat().filter(input => input.file.kind === 'change');
      capacity(tail.length <= DATASET_LIMITS.tailHard + DATASET_LIMITS.writers - 1
        && tail.reduce((sum, input) => sum + input.value.revision.size, 0) <= DATASET_LIMITS.checkpointBytes * DATASET_LIMITS.writers);
      requested = new Set();
      const known = new Map([...shards].flatMap(([shard, inputs]) => inputs.map(input => [input.file.id, shard])));
      let exhausted = false;
      do {
        invalid(!seenCursors.has(cursor)); seenCursors.add(cursor);
        const page = await this.#store.listDatasetChanges({ cursor, signal });
        invalid(Array.isArray(page.changes) && page.changes.length <= 100 && Boolean(page.nextCursor) !== Boolean(page.cursor));
        events += page.changes.length; bytes += new TextEncoder().encode(canonicalJson(page)).length;
        for (const change of page.changes) {
          if (change.legacyWrite && !change.removed) residualLegacy = true;
          if (change.removed) { if (known.has(change.id)) requested.add(known.get(change.id));
            if ([plan.rootId, plan.readyId, descriptor.id, plan.fenceId].includes(change.id)) changed(false); }
          else if (change.file?.datasetId === plan.datasetId && ['change', 'checkpoint'].includes(change.file.kind)) requested.add(change.file.shard);
          else if (change.legacyReset || change.file?.kind === 'dataset' && change.file.datasetId !== plan.datasetId) changed(false);
        }
        cursor = page.nextCursor ?? page.cursor;
        if (events >= DATASET_LIMITS.feedEvents || bytes >= DATASET_LIMITS.feedBytes) { exhausted = true; break; }
        if (!page.nextCursor) break;
      } while (true);
      if (exhausted) break;
      if (!requested.size) { complete = true; break; }
      // The next list follows the returned boundary. Do not reject a stable end token on an empty follow-up feed.
      seenCursors.delete(cursor);
    }
    const inputs = [...shards.values()].flat();
    const heads = [...shards.values()].flatMap(values => mergeDatasetInputs(values));
    const purges = await this.purges(plan, [...localEntities, ...heads.filter(head => head.record.kind === 'card').map(head => head.record.entityId)], signal);
    await this.assertGeneration(descriptor, plan, signal);
    const forbidden = new Set(purges.map(value => value.entityId));
    return { heads: heads.filter(head => head.record.kind !== 'card' || !forbidden.has(head.record.entityId)), purges,
      dirtyEntities: [...new Set(heads.filter(head => head.record.kind === 'card' && forbidden.has(head.record.entityId)).map(head => head.record.entityId))],
      inputs: inputs.map(input => input.file), cursor: complete ? cursor : null, complete, residualLegacy };
  }
}
