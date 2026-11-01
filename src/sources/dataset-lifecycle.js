import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { datasetFile, datasetRecord, DATASET_SHARDS, encodeDatasetRecord, validateDatasetFile } from './dataset-codec.js';
import { DatasetProtocol, listDatasetObjects } from './dataset-protocol.js';
import { revisionRecord } from './revisions.js';
import { t } from '../i18n/index.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));

/** Explicit prepare/ready lifecycle. No timestamp selects between concurrent initializers. */
export class DatasetLifecycle {
  #store; #journal; #protocol;
  constructor(store, journal) { this.#store = store; this.#journal = journal; this.#protocol = new DatasetProtocol(store, journal); }

  async inspect(signal) {
    const [files, fences] = await Promise.all([
      listDatasetObjects(this.#store, { scope: 'datasets' }, { signal, limit: 16 }),
      listDatasetObjects(this.#store, { scope: 'fences' }, { signal, limit: 16 }),
    ]);
    const candidates = [];
    for (const descriptor of files) {
      const plan = await this.#protocol.read(descriptor, signal);
      invalid(plan.kind === 'dataset' && descriptor.parentId === plan.rootId);
      if (same(fences.map(file => file.id).sort(), plan.fenceId ? [plan.fenceId] : [])) candidates.push({ descriptor, plan });
    }
    if (candidates.length > 1) return { phase: 'conflict', candidates };
    if (candidates.length) {
      const binding = candidates[0];
      try { await this.#protocol.assertGeneration(binding.descriptor, binding.plan, signal); }
      catch (error) { if (missing(error) || error.code === 'dataset-changed') return { phase: 'preparing', candidates }; throw error; }
      return { phase: 'ready', binding };
    }
    if (files.length || fences.length) return { phase: 'incompatible', candidates: [] };
    // An empty account is established by one metadata page, never a scan/download of legacy history.
    const page = await this.#store.listObjects({ query: { scope: 'legacy' }, signal });
    invalid(Array.isArray(page.files) && !page.incomplete);
    return { phase: page.files.length || page.nextPageToken ? 'incompatible' : 'empty', candidates: [] };
  }

  async #folder(file, signal) {
    validateDatasetFile(file);
    try { invalid(same(await this.#store.getObject({ id: file.id, signal }), file)); return; }
    catch (error) { if (!missing(error)) throw error; }
    try { await this.#store.createFolder({ file, signal }); }
    catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
    invalid(same(await this.#store.getObject({ id: file.id, signal }), file));
  }

  async #object(item, signal) {
    try { invalid(same(await this.#protocol.read(item.file, signal), item.value)); return; }
    catch (error) { if (!missing(error)) throw error; }
    try { await this.#store.createObject({ file: item.file, bytes: encodeDatasetRecord(item.value), signal }); }
    catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
    invalid(same(await this.#protocol.read(item.file, signal), item.value));
  }

  async initialize({ fenceId = null, starter = true, signal, key = 'dataset-initialize', allowExisting = false,
    guard = async () => {} } = {}) {
    await guard();
    let job = await this.#journal.getJob(key);
    if (!job) {
      if (!allowExisting) {
        const found = await this.inspect(signal);
        if (found.phase === 'ready') return found.binding;
        requireValue(found.phase === 'empty', found.phase === 'conflict' ? 'initialization-conflict' : 'incompatible-cloud-data',
          t(found.phase === 'conflict' ? 'errors.sources.initializationConflict' : 'errors.sources.incompatibleCloudData'));
      }
      const datasetId = crypto.randomUUID();
      const allocate = () => this.#store.allocateFileId({ signal });
      const rootId = await allocate(), readyId = await allocate();
      const folders = { notes: await allocate(), groups: await allocate(), current: await allocate(), purges: await allocate(), shards: {}, buckets: {} };
      for (const shard of DATASET_SHARDS) folders.shards[shard] = await allocate();
      for (const shard of DATASET_SHARDS.filter(id => id !== 'groups')) folders.buckets[shard] = await allocate();
      const plan = datasetRecord(datasetId, 'dataset', { rootId, readyId, fenceId, folders });
      const folder = (id, parentId, role, extra = {}) => ({ id, parentId, role, datasetId, kind: 'folder', ...extra });
      const directories = [folder(rootId, 'appDataFolder', 'root', { kind: 'dataset-root' }),
        ...['notes', 'groups', 'current', 'purges'].map(role => folder(folders[role], rootId, role)),
        ...DATASET_SHARDS.map(shard => folder(folders.shards[shard], folders.current, `shard-${shard}`)),
        ...Object.entries(folders.buckets).map(([shard, id]) => folder(id, folders.purges, `bucket-${shard}`))];
      const objects = [], heads = [];
      const object = async (parentId, value, id = null) => {
        const { file } = await datasetFile(id ?? await allocate(), parentId, value); const item = { file, value }; objects.push(item); return item;
      };
      const descriptor = (await object(rootId, plan)).file;
      if (starter) {
        const group = { id: crypto.randomUUID(), revision: crypto.randomUUID(), name: t('app.groups.defaultName'), deleted: false };
        const parentId = await allocate(); directories.push(folder(parentId, folders.groups, 'group', { entityId: group.id }));
        const record = revisionRecord('group', group);
        const item = await object(parentId, datasetRecord(datasetId, 'revision', { record, attachments: [] }));
        heads.push({ record, file: item.file, attachments: [] });
      }
      const initial = [];
      for (const shard of DATASET_SHARDS) initial.push((await object(folders.shards[shard], datasetRecord(datasetId, 'checkpoint', {
        operationId: crypto.randomUUID(), shard, inputs: [], heads: shard === 'groups' ? heads : [],
      }))).file);
      await object(rootId, datasetRecord(datasetId, 'ready', { descriptor: { id: descriptor.id, sha256: descriptor.sha256 }, initial }), readyId);
      job = { kind: 'dataset-initialize', sourceId: this.#store.sourceId, binding: { descriptor, plan }, directories, objects, phase: 'prepare' };
      await this.#journal.putJob(key, job);
    }
    invalid(job.kind === 'dataset-initialize' && job.sourceId === this.#store.sourceId && job.binding.plan.fenceId === fenceId);
    if (job.phase === 'ready') {
      if (!allowExisting) await this.#protocol.assertGeneration(job.binding.descriptor, job.binding.plan, signal);
      else {
        invalid(same(await this.#protocol.read(job.binding.descriptor, signal), job.binding.plan));
        invalid(same(await this.#protocol.read(job.objects.at(-1).file, signal), job.objects.at(-1).value));
        invalid(same(await this.#store.getObject({ id: job.binding.plan.rootId, signal }), job.directories[0]));
      }
      await guard(); return copy(job.binding);
    }
    const ready = job.objects.at(-1);
    if (job.phase === 'prepare') {
      for (const file of job.directories) { signal?.throwIfAborted(); await guard(); await this.#folder(file, signal); }
      for (const item of job.objects.slice(0, -1)) { signal?.throwIfAborted(); await guard(); await this.#object(item, signal); }
      job = { ...job, phase: 'ready-pending' }; await this.#journal.putJob(key, job);
    }
    // Once readiness may have been observed, never recreate retired initial checkpoints or a deleted root.
    try { invalid(same(await this.#protocol.read(ready.file, signal), ready.value)); }
    catch (error) {
      if (!missing(error)) throw error;
      for (const item of job.objects.slice(0, -1)) invalid(same(await this.#protocol.read(item.file, signal), item.value));
      await guard(); await this.#object(ready, signal);
    }
    invalid(same(await this.#store.getObject({ id: job.binding.plan.rootId, signal }), job.directories[0]));
    await guard(); await this.#journal.putJob(key, { ...job, phase: 'ready' });
    return copy(job.binding);
  }
}
