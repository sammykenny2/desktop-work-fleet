import { copy, requireValue } from '../core/contracts.js';
import { Workspace } from '../core/workspace.js';
import { prepareRestore, SafetyBackupReceipt } from './restore.js';
import { FileSync, resetSource } from '../sources/file-sync.js';

const planKey = Symbol('cloud-restore-plan');

/** A verified backup prepared against an empty destination, bound to the current account and revision. */
export class CloudRestorePlan {
  #state; #restore; #source; #empty;
  constructor(key, state, restore, sourceId, empty) {
    requireValue(key === planKey, 'invalid-restore-plan', '需要有效的雲端覆蓋預覽。');
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
      'restore-profile', 'Google 帳號已切換，請重新預覽。');
    requireValue(state.revision === this.#state.revision, 'stale-restore-plan', '預覽後資料已變更，請重新預覽。');
    requireValue(binding?.profileId === state.profileId && binding.revision === state.revision,
      'missing-safety-backup', '請先成功保存目前 Google 工作空間的備份。');
    const next = this.#restore.materialize(this.#empty);
    next.revision = state.revision + 1;
    next.cloudRestore = { sourceId, phase: 'reset', fingerprint: this.#restore.preview.fingerprint };
    return next;
  }
}

export async function prepareCloudRestore({ workspace, document, sourceId, ...options }) {
  const current = workspace.state;
  requireValue(current.profileId.startsWith('google:') && typeof sourceId === 'string' && sourceId.length > 0,
    'restore-profile', '請先登入要覆蓋的 Google 帳號。');
  requireValue(!current.cloudRestore, 'cloud-restore-pending', '請先完成尚未完成的 Google 覆蓋。');
  const empty = await Workspace.create({ profileId: current.profileId, deviceId: current.layout.deviceId,
    area: options.workAreas?.[0], bootstrapGroup: false, persist: async () => {} });
  const restore = await prepareRestore({ ...options, workspace: empty, document, mode: 'merge' });
  return new CloudRestorePlan(planKey, current, restore, sourceId, empty.state);
}

/** Save the complete replacement locally before any remote deletion. A restart reads this durable job. */
export async function stageCloudRestore({ workspace, storage, fileStore, plan, safetyBackup }) {
  requireValue(plan instanceof CloudRestorePlan, 'invalid-restore-plan', '需要有效的雲端覆蓋預覽。');
  const current = workspace.state;
  const next = plan.materialize(current, safetyBackup, fileStore.sourceId);
  await storage.saveWithAttachments(next, current.revision, plan.attachments);
  return next;
}

/** Reset and upload are separate durable phases: upload retries never clear the restored cloud again. */
export async function resumeCloudRestore({ state, storage, fileStore, progress = () => {}, resetOptions = {} }) {
  state = copy(state);
  requireValue(state.profileId.startsWith('google:') && state.cloudRestore?.sourceId === fileStore.sourceId
    && ['reset', 'upload'].includes(state.cloudRestore.phase), 'restore-profile', '覆蓋工作不屬於目前 Google 帳號。');
  if (state.cloudRestore.phase === 'reset') {
    progress('正在清空 Google 的 Work Fleet 資料…');
    await resetSource(fileStore, { ...resetOptions, progress: (done, total) => progress(`正在清空雲端：${done} / ${total}`) });
    const next = copy(state); next.revision++; next.cloudRestore.phase = 'upload';
    await storage.save(next, state.revision); state = next;
  }
  progress('正在將備份還原到 Google…');
  const workspace = new Workspace(state, (next, revision) => storage.save(next, revision));
  const sync = new FileSync({ workspace, storage, fileStore });
  try {
    await sync.sync({ force: true });
    requireValue(workspace.pendingOperations.length === 0, 'cloud-restore-pending', '備份仍有資料等待上傳，請繼續覆蓋。');
    const next = workspace.state; delete next.cloudRestore; next.revision++;
    await storage.save(next, workspace.state.revision);
    return next;
  } finally { await sync.stop({ endSession: false }); }
}
