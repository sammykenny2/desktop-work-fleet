import { copy, requireValue } from '../core/contracts.js';
import { Workspace } from '../core/workspace.js';
import { prepareRestore, SafetyBackupReceipt } from './restore.js';
import { FileSync, resetSource } from '../sources/file-sync.js';
import { t } from '../i18n/index.js';

const planKey = Symbol('cloud-restore-plan');

/** A verified backup prepared against an empty destination, bound to the current account and revision. */
export class CloudRestorePlan {
  #state; #restore; #source; #empty;
  constructor(key, state, restore, sourceId, empty) {
    requireValue(key === planKey, 'invalid-restore-plan', t('errors.backup.cloudPlanRequired'));
    this.#state = state; this.#restore = restore; this.#source = sourceId; this.#empty = empty;
  }
  get attachments() { return this.#restore.attachments; }
  get preview() {
    return { ...this.#restore.preview, mode: 'cloud-replace', profileId: this.#state.profileId,
      revision: this.#state.revision, requiresSafetyBackup: true };
  }
  materialize(state, safety, sourceId) {
    const binding = safety instanceof SafetyBackupReceipt ? safety.binding : null;
    requireValue(state.profileId === this.#state.profileId && sourceId === this.#source,
      'restore-profile', t('errors.backup.cloudAccountChanged'));
    requireValue(state.revision === this.#state.revision, 'stale-restore-plan', t('errors.common.previewStale'));
    requireValue(binding?.profileId === state.profileId && binding.revision === state.revision,
      'missing-safety-backup', t('errors.backup.cloudSafetyBackupRequired'));
    const next = this.#restore.materialize(this.#empty);
    next.revision = state.revision + 1;
    next.cloudRestore = { sourceId, phase: 'reset', fingerprint: this.#restore.preview.fingerprint };
    return next;
  }
}

export async function prepareCloudRestore({ workspace, document, sourceId, ...options }) {
  const current = workspace.state;
  requireValue(current.profileId.startsWith('google:') && typeof sourceId === 'string' && sourceId.length > 0,
    'restore-profile', t('errors.backup.cloudSignInRequired'));
  requireValue(!current.cloudRestore, 'cloud-restore-pending', t('errors.backup.cloudRestorePending'));
  const empty = await Workspace.create({ profileId: current.profileId, deviceId: current.layout.deviceId,
    area: options.workAreas?.[0], bootstrapGroup: false, persist: async () => {} });
  const restore = await prepareRestore({ ...options, workspace: empty, document, mode: 'merge' });
  return new CloudRestorePlan(planKey, current, restore, sourceId, empty.state);
}

/** Save the complete replacement locally before any remote deletion. A restart reads this durable job. */
export async function stageCloudRestore({ workspace, storage, fileStore, plan, safetyBackup }) {
  requireValue(plan instanceof CloudRestorePlan, 'invalid-restore-plan', t('errors.backup.cloudPlanRequired'));
  const current = workspace.state;
  const next = plan.materialize(current, safetyBackup, fileStore.sourceId);
  await storage.saveWithAttachments(next, current.revision, plan.attachments);
  return next;
}

/** Reset and upload are separate durable phases: upload retries never clear the restored cloud again. */
export async function resumeCloudRestore({ state, storage, fileStore, progress = () => {}, resetOptions = {} }) {
  state = copy(state);
  requireValue(state.profileId.startsWith('google:') && state.cloudRestore?.sourceId === fileStore.sourceId
    && ['reset', 'upload'].includes(state.cloudRestore.phase), 'restore-profile', t('errors.backup.cloudJobMismatch'));
  if (state.cloudRestore.phase === 'reset') {
    progress(t('backup.cloudRestore.clearing'));
    await resetSource(fileStore, { ...resetOptions, job: state.cloudRestore.resetJob,
      initialization: { mode: 'restore', records: state.revisions,
        attachments: state.revisions.flatMap(record => (record.value.content?.attachments || []).map(file => file.id)) },
      saveJob: async job => {
        const next = copy(state); next.revision++; next.cloudRestore.resetJob = job;
        await storage.save(next, state.revision); state = next;
      }, progress: (done, total) => progress(t('backup.cloudRestore.clearingProgress', { done, total })) });
    const next = copy(state); next.revision++; next.cloudRestore.phase = 'upload';
    await storage.save(next, state.revision); state = next;
  }
  progress(t('backup.cloudRestore.restoring'));
  const workspace = new Workspace(state, (next, revision) => storage.save(next, revision));
  const sync = new FileSync({ workspace, storage, fileStore, initializationPlan: state.cloudRestore.resetJob?.planId });
  try {
    await sync.sync({ force: true });
    requireValue(workspace.pendingOperations.length === 0 && workspace.syncState.initialization?.activePlan,
      'cloud-restore-pending', t('errors.backup.cloudUploadPending'));
    const next = workspace.state; delete next.cloudRestore; next.revision++;
    await storage.save(next, workspace.state.revision);
    return next;
  } finally { await sync.stop({ endSession: false }); }
}
