import { requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { DatasetPublisher, datasetUploadKey } from './dataset-publisher.js';
import { DatasetProtocol } from './dataset-protocol.js';
import { t } from '../i18n/index.js';

const invalid = condition => requireValue(condition, 'invalid-reset-job', t('errors.sources.resetJobInvalid'));

/** Upload a captured restore outbox before readiness, without creating an H-sized current receipt tail. */
export class DatasetSeed {
  #workspace; #storage; #store; #header; #progress;
  constructor({ workspace, storage, fileStore, header, progress = () => {} }) {
    this.#workspace = workspace; this.#storage = storage; this.#store = fileStore; this.#header = header; this.#progress = progress;
  }
  async initialize(binding, guard, signal, { limit = Infinity } = {}) {
    const header = this.#header, progressKey = `seed-progress:${header.operationId}`, headIds = new Set(header.heads);
    invalid(this.#workspace.state.profileId === header.profileId && this.#store.sourceId === header.sourceId);
    const session = await this.#workspace.beginSync(this.#store.sourceId);
    const check = async () => { signal?.throwIfAborted(); this.#workspace.assertSyncSession(session); await guard(); };
    const publisher = new DatasetPublisher({ store: this.#store, storage: this.#storage, profileId: header.profileId, guard: check, signal });
    let progress = await this.#storage.getControl(progressKey) ?? { done: 0, complete: header.lastOperation === null };
    let published = 0;
    try {
      while (!progress.complete) {
        await check();
        const page = await this.#storage.pendingPage({ limit: 20 }); invalid(page.operations.length);
        for (const operation of page.operations) {
          await check();
          const job = await publisher.body(binding.plan, operation, await publisher.reserve(binding.plan, operation, { receipt: false }));
          await check();
          progress = { done: progress.done + 1, complete: operation.operationId === header.lastOperation };
          invalid(progress.done <= header.total && (!progress.complete || progress.done === header.total));
          const controls = [{ key: progressKey, value: progress }];
          if (headIds.has(operation.operationId)) controls.push({ key: `seed-head:${header.operationId}:${operation.operationId}`,
            value: { file: job.revision, attachments: job.attachments } });
          await this.#workspace.acknowledgeOperations(session, [operation.operationId], {
            jobs: [datasetUploadKey(binding.plan.datasetId, operation.operationId, false)], controls });
          this.#progress({ phase: 'seed', completed: progress.done, total: header.total });
          if (progress.complete) break;
          if (++published >= limit) return null;
        }
        // Seed work yields between bounded pages so cancellation and foreground events can run.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const heads = [], protocol = new DatasetProtocol(this.#store, this.#storage);
      for (const id of header.heads) {
        const record = await this.#storage.get(id), location = await this.#storage.getControl(`seed-head:${header.operationId}:${id}`);
        invalid(record && location?.file.datasetId === binding.plan.datasetId);
        const value = await protocol.read(location.file, signal);
        invalid(canonicalJson(value.record) === canonicalJson(record) && canonicalJson(value.attachments) === canonicalJson(location.attachments));
        heads.push({ record, ...location });
      }
      await check(); return heads;
    } finally { await this.#workspace.endSync(session); }
  }
  async cleanup() {
    await this.#storage.deleteControl(`seed-progress:${this.#header.operationId}`);
    for (const id of this.#header.heads) await this.#storage.deleteControl(`seed-head:${this.#header.operationId}:${id}`);
  }
}
