import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { revisionRecord } from './revisions.js';
import { datasetFile, datasetRecord, encodeDatasetRecord, validateDatasetFile, verifyDatasetBytes } from './dataset-codec.js';
import { DatasetProtocol, listDatasetObjects } from './dataset-protocol.js';
import { t } from '../i18n/index.js';
import { ensureDatasetDirectory } from './dataset-folders.js';

const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
export const datasetUploadKey = (dataset, operation, receipt = true) => `${receipt ? 'upload' : 'seed-upload'}:${dataset}:${operation}`;

/** Shared immutable-body publisher. Its journal contains locators, never a second copy of revision contents. */
export class DatasetPublisher {
  #store; #storage; #profile; #guard; #signal; #protocol;
  // IDs allocated by this publisher and not tried yet. Drive cannot hold them, so asking first would only return a 404.
  // Nothing durable marks them: a job found in the journal may have reached Drive, and always asks.
  #untried = new Set();
  constructor({ store, storage, profileId, guard, signal, records = null }) {
    this.#store = store; this.#storage = storage; this.#profile = profileId; this.#guard = guard; this.#signal = signal;
    this.#protocol = new DatasetProtocol(store, storage, { records });
  }
  async #allocate(count) {
    const ids = [];
    while (ids.length < count) ids.push(...await this.#store.allocateFileIds(Math.min(count - ids.length, 100), { signal: this.#signal }));
    for (const id of ids) this.#untried.add(id);
    return ids;
  }
  async reserve(plan, operation, { receipt = true } = {}) {
    const key = datasetUploadKey(plan.datasetId, operation.operationId, receipt);
    let job = await this.#storage.getJob(key);
    if (!job) {
      const folderKey = `folder:${plan.datasetId}:${operation.kind}:${operation.entityId}`;
      let folder = await this.#storage.getControl(folderKey), existing = [];
      if (!folder) {
        existing = await listDatasetObjects(this.#store, { scope: 'entity-folders', datasetId: plan.datasetId, entities: [operation.entityId] },
          { limit: 32, signal: this.#signal });
        for (const file of existing) invalid(file.parentId === plan.folders[operation.kind === 'card' ? 'notes' : 'groups'] && file.role === (operation.kind === 'card' ? 'note' : 'group'));
      }
      // Everything this operation still needs an ID for is known before asking, so one request can answer it.
      const wanted = [];
      for (const attachment of operation.value.content?.attachments ?? []) {
        if (wanted.some(item => item.attachment.id === attachment.id)) continue;
        const key = `attachment:${plan.datasetId}:${operation.entityId}:${attachment.id}`, file = await this.#storage.getControl(key);
        const size = file ? null : attachment.size ?? (await this.#storage.getAttachment(this.#profile, attachment.id))?.size;
        requireValue(file || Number.isSafeInteger(size), 'missing-attachment', t('errors.sources.attachmentMissing'));
        wanted.push({ attachment, key, file, size });
      }
      const ids = await this.#allocate((folder || existing.length ? 0 : 1) + wanted.filter(item => !item.file).length + (receipt ? 2 : 1));
      if (!folder) {
        folder = { ...(existing.sort((a, b) => a.id.localeCompare(b.id))[0] ?? { id: ids.shift(), kind: 'folder', datasetId: plan.datasetId,
          parentId: plan.folders[operation.kind === 'card' ? 'notes' : 'groups'], role: operation.kind === 'card' ? 'note' : 'group', entityId: operation.entityId }), reserved: !existing.length };
        await this.#storage.putControl(folderKey, folder);
      }
      const { reserved = false, ...directory } = folder; validateDatasetFile(directory);
      const attachments = [];
      for (const { attachment, key: fileKey, file: known, size } of wanted) {
        let file = known;
        if (!file) {
          file = validateDatasetFile({ id: ids.shift(), kind: 'attachment', datasetId: plan.datasetId,
            parentId: directory.id, entityId: operation.entityId, sha256: attachment.id, size });
          await this.#storage.putControl(fileKey, file);
        }
        invalid(file.parentId === directory.id); attachments.push(file);
      }
      const value = datasetRecord(plan.datasetId, 'revision', { record: revisionRecord(operation.kind, operation.value, operation.parents), attachments });
      const revision = (await datasetFile(ids.shift(), directory.id, value)).file;
      const change = receipt ? (await datasetFile(ids.shift(), plan.folders.shards[revision.shard],
        datasetRecord(plan.datasetId, 'change', { revision }))).file : null;
      job = { kind: receipt ? 'dataset-upload' : 'dataset-seed-upload', operationId: operation.operationId,
        folder: directory, newFolder: reserved, attachments, revision, change, phase: 'reserved' };
      await this.#storage.putJob(key, job);
    }
    invalid(job.kind === (receipt ? 'dataset-upload' : 'dataset-seed-upload') && job.operationId === operation.operationId
      && job.folder.datasetId === plan.datasetId && job.revision.parentId === job.folder.id);
    const item = this.revision(job, operation);
    invalid(equal((await datasetFile(job.revision.id, job.folder.id, item.value)).file, job.revision));
    return job;
  }
  revision(job, operation) {
    return { file: job.revision, value: datasetRecord(job.revision.datasetId, 'revision', {
      record: revisionRecord(operation.kind, operation.value, operation.parents), attachments: job.attachments }) };
  }
  change(job) { return { file: job.change, value: datasetRecord(job.revision.datasetId, 'change', { revision: job.revision }) }; }
  async publish(item, plan) {
    if (!this.#untried.delete(item.file.id)) {
      try { invalid(equal(await this.#protocol.read(item.file, this.#signal), item.value)); this.#protocol.remember(item.file, item.value); return; }
      catch (error) { if (!missing(error)) throw error; }
    }
    await this.#guard(item.file.entityId, item.file.shard === 'groups' ? 'group' : 'card');
    if (item.file.kind === 'change') await ensureDatasetDirectory(this.#store, plan, item.file.parentId,
      { signal: this.#signal, guard: () => this.#guard(item.file.entityId, item.file.shard === 'groups' ? 'group' : 'card') });
    try { await this.#store.createObject({ file: item.file, bytes: encodeDatasetRecord(item.value), signal: this.#signal }); }
    catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
    invalid(equal(await this.#protocol.read(item.file, this.#signal), item.value));
    this.#protocol.remember(item.file, item.value);
  }
  async #folderPresent(job) {
    if (this.#untried.delete(job.folder.id)) return false;
    try { invalid(equal(await this.#store.getObject({ id: job.folder.id, signal: this.#signal }), job.folder)); return true; }
    catch (error) {
      if (!missing(error)) throw error;
      requireValue(job.newFolder && job.phase === 'reserved', 'dataset-changed', t('errors.sources.datasetChanged'));
      return false;
    }
  }
  async body(plan, operation, job) {
    const key = datasetUploadKey(plan.datasetId, operation.operationId, Boolean(job.change));
    if (!await this.#folderPresent(job)) {
      await this.#guard(operation.entityId, operation.kind);
      await ensureDatasetDirectory(this.#store, plan, job.folder.parentId,
        { signal: this.#signal, guard: () => this.#guard(operation.entityId, operation.kind) });
      try { await this.#store.createFolder({ file: job.folder, signal: this.#signal }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      invalid(equal(await this.#store.getObject({ id: job.folder.id, signal: this.#signal }), job.folder));
    }
    if (job.phase === 'reserved') {
      await this.#storage.putControl(`folder:${plan.datasetId}:${operation.kind}:${operation.entityId}`, { ...job.folder, reserved: false });
      job = { ...job, phase: 'body' }; await this.#storage.putJob(key, job);
    }
    for (const file of job.attachments) {
      let present = false;
      if (!this.#untried.delete(file.id)) {
        try { invalid(equal(await this.#store.getObject({ id: file.id, signal: this.#signal }), file)); present = true; }
        catch (error) { if (!missing(error)) throw error; }
      }
      if (present) continue;
      const blob = await this.#storage.getAttachment(this.#profile, file.sha256);
      requireValue(blob instanceof Blob, 'missing-attachment', t('errors.sources.attachmentMissing'));
      const bytes = new Uint8Array(await blob.arrayBuffer()); await verifyDatasetBytes(file, bytes);
      await this.#guard(operation.entityId, operation.kind);
      try { await this.#store.createObject({ file, bytes, signal: this.#signal }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      await verifyDatasetBytes(file, await this.#store.readObject({ file, signal: this.#signal }));
    }
    await this.publish(this.revision(job, operation), plan); return job;
  }
}
