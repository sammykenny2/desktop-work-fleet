import { requireValue } from '../core/contracts.js';
import { canonicalJson } from '../sources/json.js';
import { encodeRevision } from '../sources/revisions.js';
import { BACKUP_LIMITS, backupScheduler } from './archive.js';
import { t } from '../i18n/index.js';

export const DATASET_BACKUP_COVERAGE = ['complete-retained-history', 'current-state-only'];

/** Explicit bounded capture. Remote history enumeration finishes before downloading uncached revision bodies. */
export async function captureDataset({ workspace, state, coverage, signal, progress = () => {} }) {
  requireValue(DATASET_BACKUP_COVERAGE.includes(coverage), 'invalid-backup-data', t('errors.backup.dataInvalid'));
  const complete = coverage === 'complete-retained-history', checkpoint = backupScheduler(signal);
  const verify = async () => { await checkpoint(); await workspace.verifyHistorySnapshot(state, { remote: complete }); };
  await verify();
  const records = new Map(), locators = new Map(), estimates = new Map(), draftCount = Object.keys(state.drafts).length; let bytes = 0;
  const budget = (id, size) => {
    const previous = estimates.get(id) ?? 0; estimates.set(id, Math.max(previous, size)); bytes += Math.max(previous, size) - previous;
    requireValue(estimates.size
    + draftCount + 3 <= BACKUP_LIMITS.entries && bytes <= BACKUP_LIMITS.expandedBytes,
    'backup-limit', t('errors.backup.dataLimit'));
  };
  const remember = record => {
    const previous = records.get(record.revisionId);
    requireValue(!previous || canonicalJson(previous) === canonicalJson(record), 'revision-collision', t('errors.backup.revisionCollision'));
    if (!previous) { records.set(record.revisionId, record); budget(record.revisionId, encodeRevision(record).length); }
  };
  for (const record of state.revisions) remember(record);
  if (complete) {
    const entities = new Map(state.revisions.map(record => [`${record.kind}:${record.entityId}`, record]));
    for (const { kind, entityId } of entities.values()) {
      let after = null; const cursors = new Set(); let remote = !state.profileId.startsWith('google:');
      do {
        const page = await workspace.historyPage(kind, entityId, { after, limit: 50 });
        for (const record of page.records) remember(record);
        for (const entry of page.entries ?? []) if (!locators.has(entry.file.id)) {
          locators.set(entry.file.id, entry); budget(entry.revisionId, entry.file.size);
        }
        if (page.coverage === 'retained') remote = true;
        after = page.next;
        if (after) {
          const cursor = canonicalJson(after);
          requireValue(!cursors.has(cursor), 'incomplete-backup', t('errors.backup.historyIncomplete')); cursors.add(cursor);
        }
        progress({ phase: 'history', completed: records.size, total: records.size + locators.size }); await checkpoint();
      } while (after);
      requireValue(remote, 'incomplete-backup', t('errors.backup.historyIncomplete'));
    }
    // Count and byte preflight is deliberately conservative when clones have duplicate envelope copies.
    for (const entry of locators.values()) {
      const record = await workspace.historicalRevision(entry.revisionId, { file: entry.file });
      requireValue(record?.kind === entry.kind && record.entityId === entry.entityId, 'incomplete-backup', t('errors.backup.historyIncomplete'));
      remember(record);
      progress({ phase: 'history', completed: records.size, total: records.size + locators.size }); await checkpoint();
    }
  }
  await verify(); return { records: [...records.values()], verify };
}
