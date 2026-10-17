import { requireValue } from '../core/contracts.js';
import { checkCancelled } from './archive.js';
import { createBackup } from './payload.js';
import { t } from '../i18n/index.js';

/** Cloud exports refresh the replica first; a failed refresh never silently becomes a cloud backup. */
export async function createSourceBackup({ workspace, storage, source, confirmKnownData = async () => false, ...options }) {
  const profileId = workspace.state.profileId;
  let knownDataOnly = false;
  checkCancelled(options.signal);
  if (profileId.startsWith('google:')) {
    try {
      requireValue(typeof source?.sync === 'function', 'backup-sync-unavailable', t('errors.backup.exportSyncUnavailable'));
      await source.sync(); checkCancelled(options.signal);
      requireValue(workspace.state.outbox.length === 0, 'backup-sync-incomplete', t('errors.backup.exportSyncIncomplete'));
    } catch (error) {
      checkCancelled(options.signal);
      requireValue(await confirmKnownData(error, options.signal), 'backup-export-cancelled', t('errors.backup.exportCancelled'));
      knownDataOnly = true;
    }
  }
  checkCancelled(options.signal);
  requireValue(workspace.state.profileId === profileId, 'restore-profile', t('errors.backup.exportWorkspaceChanged'));
  const result = await createBackup({ ...options, workspace, storage });
  return { ...result, knownDataOnly };
}
