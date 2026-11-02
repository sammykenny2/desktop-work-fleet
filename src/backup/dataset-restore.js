import { copy, requireValue } from '../core/contracts.js';
import { CURRENT_WORKSPACE_FORMAT, Workspace } from '../core/workspace.js';
import { RevisionGraph } from '../sources/revisions.js';
import { DatasetReset } from '../sources/dataset-reset.js';
import { DatasetSeed } from '../sources/dataset-seed.js';
import { DatasetSync } from '../sources/dataset-sync.js';
import { BackupDocument } from './payload.js';
import { prepareRestore, remapLayout, SafetyBackupReceipt } from './restore.js';
import { backupScheduler, checkCancelled } from './archive.js';
import { deviceLayout } from './device-layout.js';
import { reconcileSourceLayout } from '../sources/projection.js';
import { LayoutStore } from '../layout/store.js';
import { t } from '../i18n/index.js';

const key = Symbol('dataset-restore-plan');

export class DatasetRestorePlan {
  #current; #restore; #empty; #source; #remote; #layout; #deferred;
  constructor(token, current, restore, empty, source, remote, layout, deferred) {
    requireValue(token === key, 'invalid-restore-plan', t('errors.backup.cloudPlanRequired'));
    this.#current = current; this.#restore = restore; this.#empty = empty; this.#source = source; this.#remote = remote;
    this.#layout = layout; this.#deferred = deferred;
  }
  get attachments() { return this.#restore.attachments; }
  get preview() { return { ...this.#restore.preview, mode: 'cloud-replace', profileId: this.#current.profileId,
    revision: this.#current.revision, requiresSafetyBackup: true, newIdentities: true, deferredPlacements: this.#deferred }; }
  async stage(workspace, storage, fileStore, safety, signal) {
    const current = workspace.state, receipt = safety instanceof SafetyBackupReceipt ? safety.binding : null;
    requireValue(current.profileId === this.#current.profileId && fileStore.sourceId === this.#source,
      'restore-profile', t('errors.backup.cloudAccountChanged'));
    requireValue(current.revision === this.#current.revision, 'stale-restore-plan', t('errors.common.previewStale'));
    requireValue(receipt?.profileId === current.profileId && receipt.revision === current.revision,
      'missing-safety-backup', t('errors.backup.cloudSafetyBackupRequired'));
    const remote = await new DatasetReset(fileStore, storage).preview(signal);
    requireValue(JSON.stringify(remote) === JSON.stringify(this.#remote), 'stale-restore-plan', t('errors.common.previewStale'));
    const next = this.#restore.materialize(this.#empty), history = next.revisions;
    if (this.#layout) next.layout = copy(this.#layout);
    const graph = await RevisionGraph.create(history, backupScheduler(signal), { allowMissingParents: true });
    next.revisions = [...graph.iterateEntities()].flatMap(entity => entity.heads);
    const pending = history.map(record => ({ operationId: record.revisionId, kind: record.kind, entityId: record.entityId,
      parents: record.parents, value: record.value }));
    next.revision = current.revision + 1; next.layout.revision = current.layout.revision + 1; next.outbox = [];
    const restored = this.#restore.receipt;
    next.restoreReceipts = { [restored.jobId]: { ...restored, mode: 'cloud-replace', baseRevision: current.revision, committedRevision: next.revision } };
    next.sync = { sourceId: this.#source, sessionId: null, cursor: null, pendingCount: pending.length,
      localHeads: next.revisions.map(record => record.revisionId) };
    const operationId = crypto.randomUUID();
    next.cloudRestore = { operationId, sourceId: this.#source, fingerprint: this.#restore.preview.fingerprint, remote,
      seed: { operationId, sourceId: this.#source, profileId: current.profileId, total: pending.length,
        lastOperation: pending.map(operation => operation.operationId).sort().at(-1) ?? null, heads: next.sync.localHeads } };
    checkCancelled(signal);
    await storage.saveWithAttachments(next, current.revision, this.attachments, { previous: current,
      replaceGeneration: true, history, pending, removedJobs: current.sync.dataset ? [`checkpoint:${current.sync.dataset.plan.datasetId}`, 'dataset-initialize'] : ['dataset-initialize'] });
    return next;
  }
}

export async function prepareDatasetRestore({ workspace, storage, fileStore, document, ...options }) {
  const current = workspace.state;
  requireValue(current.format === CURRENT_WORKSPACE_FORMAT && current.profileId.startsWith('google:') && !current.cloudRestore,
    'restore-profile', t('errors.backup.cloudSignInRequired'));
  requireValue(document instanceof BackupDocument && document.manifest.coverage?.workspaceFormat === CURRENT_WORKSPACE_FORMAT,
    'unsupported-backup-schema', t('errors.backup.legacyFormat'));
  const pending = await storage.getJob('dataset-reset');
  requireValue(!pending || pending.phase === 'complete', 'source-reset-pending', t('errors.sources.resetPending'));
  const empty = await Workspace.create({ profileId: current.profileId, deviceId: current.layout.deviceId,
    area: options.workAreas?.[0], bootstrapGroup: false, current: true, persist: async () => {} });
  const restore = await prepareRestore({ ...options, workspace: empty, document, mode: 'import' });
  let layout = null, deferred = restore.preview.deferredPlacements;
  if (options.layout !== 'backup') {
    const next = restore.materialize(empty.state), maps = restore.receipt.mappings;
    const ids = Object.fromEntries(['card', 'group', 'revision', 'draft'].map(kind => [kind, id => maps[kind]?.[id] ?? id]));
    next.layout = reconcileSourceLayout(remapLayout(deviceLayout(current.layout, document.data), ids), next);
    const placement = await new LayoutStore(next.layout, async value => { next.layout = value; })
      .placeNew(next, options.workAreas, undefined, backupScheduler(options.signal));
    layout = next.layout; deferred = placement.deferred.length;
  }
  const remote = await new DatasetReset(fileStore, storage).preview(options.signal);
  return new DatasetRestorePlan(key, current, restore, empty.state, fileStore.sourceId, remote, layout, deferred);
}

/** Restarts seed upload from the staged outbox. Readiness precedes old-data cleanup, which stays a background job. */
export async function resumeDatasetRestore({ state, storage, fileStore, progress = () => {}, signal }) {
  const workspace = new Workspace(state, (...args) => storage.save(...args), undefined, undefined, { history: storage });
  const header = copy(state.cloudRestore);
  requireValue(state.format === CURRENT_WORKSPACE_FORMAT && header?.sourceId === fileStore.sourceId,
    'restore-profile', t('errors.backup.cloudJobMismatch'));
  const reset = new DatasetReset(fileStore, storage), seed = new DatasetSeed({ workspace, storage, fileStore, header: header.seed, progress });
  let job = await reset.status();
  if (!job || job.phase === 'complete' && job.restoreOperation !== header.operationId) {
    await reset.begin(header.remote, { starter: false, seeded: true, restoreOperation: header.operationId, signal });
    job = await reset.status();
  }
  requireValue(job.restoreOperation === header.operationId, 'source-reset-pending', t('errors.sources.resetPending'));
  while (!job.ready) {
    checkCancelled(signal); job = await reset.step({ signal, seed: (binding, guard) => seed.initialize(binding, guard, signal) });
    progress({ phase: job.phase, completed: job.deleted, total: job.captured });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const sync = new DatasetSync({ workspace, storage, fileStore });
  try {
    await sync.sync({ force: true });
    await seed.cleanup();
    await workspace.finishDatasetRestore(header.operationId, job.binding.plan.datasetId);
    return workspace.state;
  } finally { await sync.stop({ endSession: false }); }
}
