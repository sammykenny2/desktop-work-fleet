import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { datasetFile, datasetRecord, datasetShard, DATASET_SHARDS, encodeDatasetRecord, validateDatasetFile } from './dataset-codec.js';
import { DatasetProtocol, visibleDatasetObjects } from './dataset-protocol.js';
import { revisionRecord } from './revisions.js';
import { t } from '../i18n/index.js';
import { datasetDirectories, ensureDatasetDirectory } from './dataset-folders.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));

/** Explicit prepare/ready lifecycle. No timestamp selects between concurrent initializers. */
export class DatasetLifecycle {
  #store; #journal; #protocol;
  constructor(store, journal) { this.#store = store; this.#journal = journal; this.#protocol = new DatasetProtocol(store, journal); }

  async inspect(signal, expected = null) {
    const [files, fences] = await Promise.all([
      visibleDatasetObjects(this.#store, { scope: 'datasets' }, expected ? [expected.descriptor.id] : [], { signal, limit: 16 }),
      visibleDatasetObjects(this.#store, { scope: 'fences' }, expected?.plan.fenceId ? [expected.plan.fenceId] : [], { signal, limit: 16 }),
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

  async initialize({ fenceId = null, starter = false, signal, key = 'dataset-initialize', allowExisting = false,
    guard = async () => {}, seed = null, progress = () => {} } = {}) {
    invalid(seed === null || typeof seed === 'function' && !starter);
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
      const reserved = this.#store.allocateFileIds
        ? await this.#store.allocateFileIds(6 + 2 * DATASET_SHARDS.length + (starter ? 3 : 0), { signal }) : null;
      const allocate = () => reserved ? Promise.resolve(reserved.shift()) : this.#store.allocateFileId({ signal });
      const rootId = await allocate(), readyId = await allocate();
      const folders = { notes: await allocate(), groups: await allocate(), current: await allocate(), purges: await allocate(), shards: {}, buckets: {} };
      for (const shard of DATASET_SHARDS) folders.shards[shard] = await allocate();
      for (const shard of DATASET_SHARDS.filter(id => id !== 'groups')) folders.buckets[shard] = await allocate();
      const plan = datasetRecord(datasetId, 'dataset', { rootId, readyId, fenceId, folders });
      const folder = (id, parentId, role, extra = {}) => ({ id, parentId, role, datasetId, kind: 'folder', ...extra });
      const directories = [datasetDirectories(plan)[0]];
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
      for (const shard of starter ? ['groups'] : []) initial.push((await object(folders.shards[shard], datasetRecord(datasetId, 'checkpoint', {
        operationId: crypto.randomUUID(), shard, inputs: [], heads: shard === 'groups' ? heads : [],
      }))).file);
      await object(rootId, datasetRecord(datasetId, 'ready', { descriptor: { id: descriptor.id, sha256: descriptor.sha256 }, initial }), readyId);
      job = { kind: 'dataset-initialize', sourceId: this.#store.sourceId, binding: { descriptor, plan }, directories, objects,
        seedMode: Boolean(seed), seeded: false, sparse: true, phase: 'prepare' };
      await this.#journal.putJob(key, job);
    }
    invalid(job.kind === 'dataset-initialize' && job.sourceId === this.#store.sourceId && job.binding.plan.fenceId === fenceId
      && job.seedMode === Boolean(seed));
    // Resume an older empty reset without materializing its unused scaffold. A published ready receipt is final.
    if (!job.sparse && !starter && !seed) {
      const oldReady = job.objects.at(-1); let ready = false;
      try { invalid(same(await this.#protocol.read(oldReady.file, signal), oldReady.value)); ready = true; }
      catch (error) { if (!missing(error)) throw error; }
      if (ready) job = { ...job, sparse: true, phase: 'ready' };
      else if (['ready', 'ready-pending'].includes(job.phase)) job = { ...job, sparse: true };
      else {
        const kept = [], group = job.objects.find(item => item.value?.kind === 'checkpoint' && item.value.shard === 'groups');
        let groupPublished = false;
        if (group) try {
          invalid(same(await this.#protocol.read(group.file, signal), group.value)); groupPublished = true;
        } catch (error) { if (!missing(error)) throw error; }
        if (groupPublished) {
          for (const head of group.value.heads) {
            const revision = job.objects.find(item => item.file.id === head.file.id); invalid(revision);
            invalid(same(await this.#protocol.read(revision.file, signal), revision.value)); kept.push(revision);
          }
          kept.push(group);
        }
        const value = { ...oldReady.value, initial: kept.filter(item => item.value.kind === 'checkpoint').map(item => item.file) };
        const file = (await datasetFile(oldReady.file.id, oldReady.file.parentId, value)).file;
        job = { ...job, directories: [job.directories[0]], objects: [job.objects[0], ...kept, { file, value }], sparse: true };
      }
      await this.#journal.putJob(key, job);
    }
    let completed = job.phase === 'prepare' ? 0 : job.directories.length + 1;
    let total = job.directories.length + job.objects.length;
    const report = () => progress({ phase: 'initialize-progress', completed, total });
    const materialize = async item => {
      if (item.value) return item;
      const stored = await this.#journal.getJob(item.key); invalid(stored && same(stored.file, item.file));
      return { file: item.file, value: stored.value };
    };
    const clean = async () => { for (const item of job.objects) if (item.key) await this.#journal.deleteJob(item.key); };
    if (job.phase === 'ready') {
      progress({ phase: 'initialize-verify' });
      if (!allowExisting) await this.#protocol.assertGeneration(job.binding.descriptor, job.binding.plan, signal);
      else {
        invalid(same(await this.#protocol.read(job.binding.descriptor, signal), job.binding.plan));
        invalid(same(await this.#protocol.read(job.objects.at(-1).file, signal), job.objects.at(-1).value));
        invalid(same(await this.#store.getObject({ id: job.binding.plan.rootId, signal }), job.directories[0]));
      }
      await guard(); await clean(); return copy(job.binding);
    }
    if (job.phase === 'prepare') {
      report();
      for (const file of job.directories) {
        signal?.throwIfAborted(); await guard();
        if (file.kind !== 'dataset-root') await ensureDatasetDirectory(this.#store, job.binding.plan, file.parentId, { signal, guard });
        await this.#folder(file, signal); completed++; report();
      }
      await this.#object(job.objects[0], signal); completed++; report();
      job = { ...job, phase: 'objects' }; await this.#journal.putJob(key, job);
    }
    if (job.phase === 'objects') {
      // Once seeded uploads may have been acknowledged, a lost root cannot be recreated as an empty namespace.
      invalid(same(await this.#store.getObject({ id: job.binding.plan.rootId, signal }), job.directories[0]));
      invalid(same(await this.#protocol.read(job.binding.descriptor, signal), job.binding.plan));
      if (seed && !job.seeded) {
        const heads = await seed(job.binding, guard);
        if (heads === null) return null; // A bounded seed slice is durable but cannot activate an incomplete dataset.
        const shards = new Map(DATASET_SHARDS.map(shard => [shard, []]));
        for (const head of heads) shards.get(await datasetShard(head.record.kind, head.record.entityId)).push(head);
        const objects = [job.objects[0]], initial = [];
        for (const [shard, values] of shards) {
          if (!values.length) continue;
          const existing = job.objects.find(item => item.value?.kind === 'checkpoint' && item.value.shard === shard);
          const value = datasetRecord(job.binding.plan.datasetId, 'checkpoint', {
            operationId: existing?.value.operationId ?? crypto.randomUUID(), shard, inputs: [], heads: values,
          });
          const file = (await datasetFile(existing?.file.id ?? await this.#store.allocateFileId({ signal }), job.binding.plan.folders.shards[shard], value)).file;
          const objectKey = `dataset-initial:${file.datasetId}:${value.operationId}`;
          await this.#journal.putJob(objectKey, { kind: 'dataset-initial', file, value });
          objects.push({ file, key: objectKey }); initial.push(file);
        }
        const old = job.objects.at(-1), value = { ...old.value, initial };
        objects.push({ file: (await datasetFile(old.file.id, old.file.parentId, value)).file, value });
        job = { ...job, objects, seeded: true }; await this.#journal.putJob(key, job);
        total = job.directories.length + job.objects.length;
      }
      for (const file of job.directories) invalid(same(await this.#store.getObject({ id: file.id, signal }), file));
      report();
      for (const item of job.objects.slice(1, -1)) {
        signal?.throwIfAborted(); await guard();
        if (item.file.kind === 'checkpoint') await ensureDatasetDirectory(this.#store, job.binding.plan, item.file.parentId, { signal, guard });
        await this.#object(await materialize(item), signal); completed++; report();
      }
      job = { ...job, phase: 'ready-pending' }; await this.#journal.putJob(key, job);
    }
    const ready = job.objects.at(-1);
    progress({ phase: 'initialize-verify' });
    // Once readiness may have been observed, never recreate retired initial checkpoints or a deleted root.
    try { invalid(same(await this.#protocol.read(ready.file, signal), ready.value)); }
    catch (error) {
      if (!missing(error)) throw error;
      for (const item of job.objects.slice(0, -1)) invalid(same(await this.#protocol.read(item.file, signal), (await materialize(item)).value));
      await guard(); await this.#object(ready, signal);
    }
    invalid(same(await this.#store.getObject({ id: job.binding.plan.rootId, signal }), job.directories[0]));
    await guard(); await this.#journal.putJob(key, { ...job, phase: 'ready' });
    await clean();
    return copy(job.binding);
  }
}
