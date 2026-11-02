import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { datasetRecord, datasetShard } from './dataset-codec.js';
import { DatasetProtocol, listDatasetObjects, mergeDatasetInputs } from './dataset-protocol.js';
import { t } from '../i18n/index.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const stale = condition => requireValue(condition, 'stale-purge', t('errors.sources.purgeStale'));
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
export const purgeJobKey = (dataset, entityId) => `purge-work:${dataset ?? 'local'}:${entityId}`;

/** Content-free terminal decisions followed by bounded, restartable physical cleanup. */
export class DatasetPurge {
  #workspace; #storage; #provider; #running = null; #activeJob = null;
  constructor({ workspace, storage, fileStore = () => null }) {
    this.#workspace = workspace; this.#storage = storage; this.#provider = typeof fileStore === 'function' ? fileStore : () => fileStore;
  }
  #local(item) {
    const heads = this.#workspace.revisionHeads('card', item.entityId);
    stale(heads.length > 0 && heads.every(head => head.value.deleted && head.value.trashEpisode === item.trashEpisode)
      && same(heads.map(head => head.revisionId).sort(), item.heads));
  }
  async preview(ids) {
    const state = this.#workspace.state, binding = state.sync.dataset ?? null, store = this.#provider();
    requireValue(state.format === 'work-fleet-workspace-current', 'incompatible-local-data', t('errors.storage.incompatibleLocalData'));
    requireValue(!state.profileId.startsWith('google:') || binding && store, 'history-offline', t('errors.sources.historyOffline'));
    stale(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length);
    const shards = new Map(), items = [];
    for (const entityId of ids) {
      const heads = this.#workspace.revisionHeads('card', entityId);
      const item = { operationId: crypto.randomUUID(), entityId, trashEpisode: heads[0]?.value.trashEpisode,
        heads: heads.map(head => head.revisionId).sort(), remoteHeads: [], folderIds: [] };
      this.#local(item);
      if (binding) {
        const shard = await datasetShard('card', entityId);
        if (!shards.has(shard)) {
          const key = state.sync.datasetView?.[shard]; stale(key);
          const view = await this.#storage.getControl(key); stale(view); shards.set(shard, view.heads);
        }
        item.remoteHeads = shards.get(shard).filter(head => head.record.kind === 'card' && head.record.entityId === entityId).map(head => head.record.revisionId).sort();
      }
      items.push(item);
    }
    return { profileId: state.profileId, datasetId: binding?.plan.datasetId ?? null, binding, items };
  }
  /** The UI confirms this exact preview before enqueuing; no history work runs in the confirmation action. */
  async enqueue(preview) {
    preview = copy(preview); const state = this.#workspace.state;
    stale(preview.profileId === state.profileId && preview.datasetId === (state.sync.dataset?.plan.datasetId ?? null));
    for (const item of preview.items) this.#local(item);
    const jobs = [], batch = crypto.randomUUID();
    for (let offset = 0; offset < preview.items.length; offset += 100) {
      jobs.push({ key: `purge-queue:${batch}:${offset}`, value: { kind: 'dataset-purge-queue', profileId: preview.profileId,
        binding: preview.binding, items: preview.items.slice(offset, offset + 100) } });
    }
    await this.#storage.putJobs(jobs); return { pending: preview.items.length };
  }
  async pending() {
    const rows = [...(await this.#storage.jobs('dataset-purge')).rows, ...(await this.#storage.jobs('dataset-purge-queue')).rows,
      ...(await this.#storage.jobs('dataset-purge-review')).rows];
    return rows.map(row => ({ key: row.key, ...row.value }));
  }
  async #detach(item) {
    const sync = this.#workspace.syncState, expectedView = sync.datasetView;
    let view = null; const controls = [];
    if (sync.dataset && expectedView) {
      const shard = await datasetShard('card', item.entityId), old = await this.#storage.getControl(expectedView[shard]);
      if (old?.heads.some(head => head.record.kind === 'card' && head.record.entityId === item.entityId)) {
        const key = `view:${sync.dataset.plan.datasetId}:${crypto.randomUUID()}:${shard}`;
        controls.push({ key, value: { ...old, heads: old.heads.filter(head => head.record.kind !== 'card' || head.record.entityId !== item.entityId) } });
        view = { ...expectedView, [shard]: key };
      }
    }
    await this.#workspace.applyPermanentDeletion([item], { view, expectedView, controls });
  }
  step({ signal } = {}) {
    if (this.#running) return this.#running;
    this.#running = this.#step(signal).catch(async error => {
      if (error.code !== 'stale-purge' || !this.#activeJob) throw error;
      const job = await this.#storage.getJob(this.#activeJob);
      if (job?.phase !== 'pending' || job.profileId !== this.#workspace.state.profileId) throw error;
      await this.#storage.putJob(this.#activeJob, { ...job, kind: 'dataset-purge-review', phase: 'needs-preview' });
      return { entityId: job.item.entityId, phase: 'needs-preview' };
    }).finally(() => { this.#running = null; this.#activeJob = null; }); return this.#running;
  }
  async #step(signal) {
    const [entry] = (await this.#storage.jobs('dataset-purge', { limit: 1 })).rows;
    if (!entry) {
      const [queue] = (await this.#storage.jobs('dataset-purge-queue', { limit: 1 })).rows;
      if (!queue) return null;
      const jobs = [], { profileId, binding, items } = queue.value;
      stale(profileId === this.#workspace.state.profileId);
      if ((binding?.plan.datasetId ?? null) !== (this.#workspace.syncState.dataset?.plan.datasetId ?? null)) {
        await this.#storage.deleteJob(queue.key); return { phase: 'retired' };
      }
      for (const item of items) {
        const key = purgeJobKey(binding?.plan.datasetId, item.entityId), local = await this.#storage.getControl(`local-purge:${item.entityId}`);
        const existing = await this.#storage.getJob(key);
        if (local?.operationId === item.operationId || existing && existing.kind !== 'dataset-purge-review') continue;
        jobs.push({ key, value: { kind: 'dataset-purge', profileId, binding, item, phase: 'pending' } });
      }
      await this.#storage.putJobs(jobs); await this.#storage.deleteJob(queue.key); return { phase: 'pending', count: jobs.length };
    }
    this.#activeJob = entry.key;
    let job = entry.value;
    const { item, binding } = job, store = this.#provider();
    stale(job.profileId === this.#workspace.state.profileId);
    if ((binding?.plan.datasetId ?? null) !== (this.#workspace.syncState.dataset?.plan.datasetId ?? null)) {
      await this.#storage.deleteJob(entry.key); return { phase: 'retired' };
    }
    requireValue(!binding || store, 'history-offline', t('errors.sources.historyOffline'));
    const protocol = binding ? new DatasetProtocol(store, this.#storage) : null;
    const save = async patch => { job = { ...job, ...patch }; await this.#storage.putJob(entry.key, job); };
    const guard = async () => {
      signal?.throwIfAborted();
      if (binding) {
        await protocol.assertGeneration(binding.descriptor, binding.plan, signal);
        if (job.phase !== 'pending') requireValue((await protocol.purges(binding.plan, [item.entityId], signal)).length > 0,
          'dataset-changed', t('errors.sources.datasetChanged'));
      }
    };
    const publication = `purge-marker:${item.operationId}:${item.entityId}`;
    await guard();
    if (job.phase === 'pending') {
      let committed = false;
      if (binding) {
        const pending = await this.#storage.getJob(publication);
        if (pending) try { invalid(same(await protocol.read(pending.file, signal), pending.value)); committed = true; }
        catch (error) { if (!missing(error)) throw error; }
      }
      if (!committed) {
        this.#local(item);
        if (binding) {
          const shard = await datasetShard('card', item.entityId);
          const heads = mergeDatasetInputs(await protocol.captureShard(binding.plan, shard, signal))
            .filter(head => head.record.kind === 'card' && head.record.entityId === item.entityId).map(head => head.record.revisionId).sort();
          stale(same(heads, item.remoteHeads)); this.#local(item);
          const folders = await listDatasetObjects(store, { scope: 'entity-folders', datasetId: binding.plan.datasetId, entities: [item.entityId] }, { limit: 32, signal });
          for (const file of folders) invalid(file.parentId === binding.plan.folders.notes && file.role === 'note');
          item.folderIds = folders.map(file => file.id).sort(); await save({ item });
          const marker = datasetRecord(binding.plan.datasetId, 'purge', { operationId: item.operationId, entityId: item.entityId,
            trashEpisode: item.trashEpisode, heads: [...new Set([...item.heads, ...item.remoteHeads])], folderIds: item.folderIds });
          await protocol.publish(publication, binding.plan.folders.buckets[shard], marker, signal);
          await this.#storage.putControl(`purge:${binding.plan.datasetId}:${item.entityId}`, marker);
        }
      }
      await save({ phase: 'committed' });
      await this.#detach(item);
      return { entityId: item.entityId, phase: 'committed' };
    }
    if (this.#workspace.snapshot.cards.some(card => card.id === item.entityId)
      || !await this.#storage.getControl(`local-purge:${item.entityId}`)) await this.#detach(item);
    if (job.phase === 'committed') {
      if (binding) {
        const shard = await datasetShard('card', item.entityId), inputs = await protocol.captureShard(binding.plan, shard, signal);
        const dirty = inputs.some(input => input.file.entityId === item.entityId
          || input.value.kind === 'checkpoint' && input.value.heads.some(head => head.record.kind === 'card' && head.record.entityId === item.entityId));
        if (dirty || await this.#storage.getJob(`checkpoint:${binding.plan.datasetId}`)) {
          const next = await protocol.checkpoint(binding.plan, shard, inputs, signal);
          await protocol.retire(binding.descriptor, binding.plan, next, signal);
          return { entityId: item.entityId, phase: 'cloud-cleanup' };
        }
      }
      await save({ phase: binding ? 'cloud' : 'local' }); return { entityId: item.entityId, phase: binding ? 'cloud-cleanup' : 'local-cleanup' };
    }
    if (job.phase === 'cloud') {
      const folders = await listDatasetObjects(store, { scope: 'entity-folders', datasetId: binding.plan.datasetId, entities: [item.entityId] }, { limit: 32, signal });
      for (const file of folders) invalid(file.role === 'note' && file.parentId === binding.plan.folders.notes);
      if (folders.length && !job.folderFallback) {
        try { await store.deleteFile({ id: folders[0].id, signal }); }
        catch (error) { if (error.code !== 'source-permission') throw error; await save({ folderFallback: true }); }
        return { entityId: item.entityId, phase: 'cloud-cleanup' };
      }
      const page = await store.listObjects({ query: { scope: 'entity-data', datasetId: binding.plan.datasetId, entities: [item.entityId] }, signal });
      invalid(Array.isArray(page.files) && page.files.length <= 100 && !page.incomplete);
      for (const file of page.files) invalid(file.datasetId === binding.plan.datasetId && file.entityId === item.entityId && ['revision', 'attachment', 'folder'].includes(file.kind));
      if (page.files.length) {
        const targets = page.files.filter(file => file.kind !== 'folder').slice(0, 20);
        if (!targets.length) targets.push(...page.files.slice(0, 1));
        for (const file of targets) { await guard(); await store.deleteFile({ id: file.id, signal }); }
        return { entityId: item.entityId, phase: 'cloud-cleanup' };
      }
      invalid(!page.nextPageToken); await save({ phase: 'local' });
    }
    if (job.phase === 'local') {
      const pending = await this.#storage.pendingForEntity('card', item.entityId);
      if (pending.length) {
        await this.#workspace.discardPurgedOperations(item.entityId, pending,
          binding ? pending.map(id => `upload:${binding.plan.datasetId}:${id}`) : []);
        return { entityId: item.entityId, phase: 'local-cleanup' };
      }
      if (!await this.#storage.cleanupHistory('card', item.entityId) || await this.#storage.maintenance()) return { entityId: item.entityId, phase: 'local-cleanup' };
      await guard();
      if (binding) {
        const inputs = await protocol.captureShard(binding.plan, await datasetShard('card', item.entityId), signal);
        if (inputs.some(input => input.file.entityId === item.entityId || input.value.kind === 'checkpoint'
          && input.value.heads.some(head => head.record.kind === 'card' && head.record.entityId === item.entityId))) {
          await save({ phase: 'committed' }); return { entityId: item.entityId, phase: 'cloud-cleanup' };
        }
        const page = await store.listObjects({ query: { scope: 'entity-data', datasetId: binding.plan.datasetId, entities: [item.entityId] }, signal });
        invalid(!page.incomplete);
        if (page.files.length || page.nextPageToken) { await save({ phase: 'committed' }); return { entityId: item.entityId, phase: 'cloud-cleanup' }; }
        await this.#storage.putControl(`purge-cleaned:${binding.plan.datasetId}:${item.entityId}`, { operationId: item.operationId });
      }
      await this.#storage.deleteJob(publication); await this.#storage.deleteJob(entry.key);
      return { entityId: item.entityId, phase: 'complete' };
    }
    return null;
  }
}
