import { requireValue } from '../core/contracts.js';
import { NativeTransfers } from '../storage/native.js';
import { checkCancelled } from './archive.js';
import { t } from '../i18n/index.js';

/** Native grants expose only opaque IDs; neither stored passwords nor filesystem paths are returned. */
export function nativeBackupAdapters(bridge, info) {
  const transfers = new NativeTransfers(bridge, info);
  const available = info.capabilities.automaticFiles === true;
  const check = profileId => requireValue(profileId === info.profileId, 'backup-profile', t('errors.common.backupProfileChanged'));
  const jobArgs = job => {
    check(job.profileId);
    const { bytes, signal, ...args } = job; return args;
  };
  const write = async (method, args, { bytes, signal, progress }) => {
    checkCancelled(signal); bytes = new Uint8Array(bytes);
    const token = await transfers.upload('backup', bytes, signal);
    try {
      checkCancelled(signal);
      // The native create/flush/readback sequence is authoritative after dispatch, including late cancellation.
      progress?.({ phase: 'save-commit', completed: 0, total: 1 });
      return await bridge.request(method, { ...args, token });
    } finally { await transfers.discard(token); }
  };
  return {
    files: {
      available, canCreate: available, canPrune: available,
      chooseDestination: () => bridge.request('backup.choose'),
      authorize: destinationId => bridge.request('backup.authorize', { destinationId }),
      create: job => write('backup.create', jobArgs(job), job),
      read: async job => { checkCancelled(job.signal); return transfers.download('backup.read', jobArgs(job), info.maxBackupBytes); },
      remove: job => { checkCancelled(job.signal); return bridge.request('backup.remove', jobArgs(job)); },
    },
    manual: {
      canConfirmSave: info.capabilities.backupFiles === true,
      chooseDestination: async () => {
        const { destinationId } = await bridge.request('backup.manual.choose');
        return { save: input => write('backup.manual.save', { destinationId }, input) };
      },
    },
    vault: {
      available: info.capabilities.secureBackup === true,
      create: async ({ password }) => (await bridge.request('backup.key.create', { password })).keyId,
      encrypt: async ({ profileId, keyId, bytes, signal }) => {
        check(profileId); checkCancelled(signal); bytes = new Uint8Array(bytes);
        const token = await transfers.upload('backup', bytes, signal);
        try {
          checkCancelled(signal);
          const result = await transfers.download('backup.encrypt', { token, keyId }, info.maxBackupBytes);
          checkCancelled(signal); return result;
        } finally { bytes.fill(0); await transfers.discard(token); }
      },
    },
  };
}
