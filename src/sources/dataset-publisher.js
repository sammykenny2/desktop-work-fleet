import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { revisionRecord } from './revisions.js';
import { datasetFile, datasetRecord, encodeDatasetRecord, validateDatasetFile, verifyDatasetBytes } from './dataset-codec.js';
import { DatasetProtocol, listDatasetObjects } from './dataset-protocol.js';
import { t } from '../i18n/index.js';

const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const invalid = condition => requireValue(condition, 'invalid-dataset', t('errors.sources.datasetInvalid'));
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
export const datasetUploadKey = (dataset, operation, receipt = true) => `${receipt ? 'upload' : 'seed-upload'}:${dataset}:${operation}`;

/** Shared immutable-body publisher. Its journal contains locators, never a second copy of revision contents. */
export class DatasetPublisher {
  #store; #storage; #profile; #guard; #signal; #protocol;
  constructor({ store, storage, profileId, guard, signal }) {
    this.#store = store; this.#storage = storage; this.#profile = profileId; this.#guard = guard; this.#signal = signal;
    this.#protocol = new DatasetProtocol(store, storage);
  }
  async reserve(plan, operation, { receipt = true } = {}) {
    const key = datasetUploadKey(plan.datasetId, operation.operationId, receipt);
    let job = await this.#storage.getJob(key);
    if (!job) {
      const folderKey = `folder:${plan.datasetId}:${operation.kind}:${operation.entityId}`;
      let folder = await this.#storage.getControl(folderKey);
      if (!folder) {
        const existing = await listDatasetObjects(this.#store, { scope: 'entity-folders', datasetId: plan.datasetId, entities: [operation.entityId] },
          { limit: 32, signal: this.#signal });
        const parentId = plan.folders[operation.kind === 'card' ? 'notes' : 'groups'];
        for (const file of existing) invalid(file.parentId === parentId && file.role === (operation.kind === 'card' ? 'note' : 'group'));
        folder = { ...(existing.sort((a, b) => a.id.localeCompare(b.id))[0] ?? { id: await this.#store.allocateFileId({ signal: this.#signal }),
          kind: 'folder', datasetId: plan.datasetId, parentId, role: operation.kind === 'card' ? 'note' : 'group', entityId: operation.entityId }), reserved: !existing.length };
        await this.#storage.putControl(folderKey, folder);
      }
      const { reserved = false, ...directory } = folder; validateDatasetFile(directory);
      const attachments = [];
      for (const attachment of operation.value.content?.attachments ?? []) {
        if (attachments.some(file => file.sha256 === attachment.id)) continue;
        const fileKey = `attachment:${plan.datasetId}:${operation.entityId}:${attachment.id}`;
        let file = await this.#storage.getControl(fileKey);
        if (!file) {
          const size = attachment.size ?? (await this.#storage.getAttachment(this.#profile, attachment.id))?.size;
          requireValue(Number.isSafeInteger(size), 'missing-attachment', t('errors.sources.attachmentMissing'));
          file = validateDatasetFile({ id: await this.#store.allocateFileId({ signal: this.#signal }), kind: 'attachment', datasetId: plan.datasetId,
            parentId: directory.id, entityId: operation.entityId, sha256: attachment.id, size });
          await this.#storage.putControl(fileKey, file);
        }
        invalid(file.parentId === directory.id); attachments.push(file);
      }
      const value = datasetRecord(plan.datasetId, 'revision', { record: revisionRecord(operation.kind, operation.value, operation.parents), attachments });
      const revision = (await datasetFile(await this.#store.allocateFileId({ signal: this.#signal }), directory.id, value)).file;
      const change = receipt ? (await datasetFile(await this.#store.allocateFileId({ signal: this.#signal }), plan.folders.shards[revision.shard],
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
  async publish(item) {
    try { invalid(equal(await this.#protocol.read(item.file, this.#signal), item.value)); return; }
    catch (error) { if (!missing(error)) throw error; }
    await this.#guard(item.file.entityId, item.file.shard === 'groups' ? 'group' : 'card');
    try { await this.#store.createObject({ file: item.file, bytes: encodeDatasetRecord(item.value), signal: this.#signal }); }
    catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
    invalid(equal(await this.#protocol.read(item.file, this.#signal), item.value));
  }
  async body(plan, operation, job) {
    const key = datasetUploadKey(plan.datasetId, operation.operationId, Boolean(job.change));
    try { invalid(equal(await this.#store.getObject({ id: job.folder.id, signal: this.#signal }), job.folder)); }
    catch (error) {
      if (!missing(error)) throw error;
      requireValue(job.newFolder && job.phase === 'reserved', 'dataset-changed', t('errors.sources.datasetChanged'));
      await this.#guard(operation.entityId, operation.kind);
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
      try { invalid(equal(await this.#store.getObject({ id: file.id, signal: this.#signal }), file)); present = true; }
      catch (error) { if (!missing(error)) throw error; }
      if (present) continue;
      const blob = await this.#storage.getAttachment(this.#profile, file.sha256);
      requireValue(blob instanceof Blob, 'missing-attachment', t('errors.sources.attachmentMissing'));
      const bytes = new Uint8Array(await blob.arrayBuffer()); await verifyDatasetBytes(file, bytes);
      await this.#guard(operation.entityId, operation.kind);
      try { await this.#store.createObject({ file, bytes, signal: this.#signal }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      await verifyDatasetBytes(file, await this.#store.readObject({ file, signal: this.#signal }));
    }
    await this.publish(this.revision(job, operation)); return job;
  }
}
