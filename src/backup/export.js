import { requireValue } from '../core/contracts.js';
import { checkCancelled } from './archive.js';
import { createBackup } from './payload.js';

/** Cloud exports refresh the replica first; a failed refresh never silently becomes a cloud backup. */
export async function createSourceBackup({ workspace, storage, source, confirmKnownData = async () => false, ...options }) {
  const profileId = workspace.state.profileId;
  let knownDataOnly = false;
  checkCancelled(options.signal);
  if (profileId.startsWith('google:')) {
    try {
      requireValue(typeof source?.sync === 'function', 'backup-sync-unavailable', '目前無法同步 Google。');
      await source.sync(); checkCancelled(options.signal);
      requireValue(workspace.state.outbox.length === 0, 'backup-sync-incomplete', '仍有修改等待同步到 Google。');
    } catch (error) {
      checkCancelled(options.signal);
      requireValue(await confirmKnownData(error, options.signal), 'backup-export-cancelled', '已取消匯出，沒有保存備份。');
      knownDataOnly = true;
    }
  }
  checkCancelled(options.signal);
  requireValue(workspace.state.profileId === profileId, 'restore-profile', '工作空間已切換，請重新匯出。');
  const result = await createBackup({ ...options, workspace, storage });
  return { ...result, knownDataOnly };
}
