import { copy, requireValue } from '../core/contracts.js';
import { Workspace } from '../core/workspace.js';
import { DatasetLifecycle } from './dataset-lifecycle.js';
import { DatasetProtocol } from './dataset-protocol.js';
import { DatasetReset } from './dataset-reset.js';
import { DatasetSync } from './dataset-sync.js';
import { reconcileSourceLayout } from './projection.js';
import { t } from '../i18n/index.js';

/** Abandon only local reset bookkeeping, atomically with an explicitly chosen replacement. */
export async function abandonedDatasetReset(storage) {
  const job = await storage.getJob('dataset-reset');
  return { removedJobs: ['dataset-reset', 'dataset-initialize'], jobs: job ? [{ key: `retired-reset:${job.operationId}`,
    value: { kind: 'retired-reset', operationId: job.operationId } }] : [] };
}

export async function cleanupDatasetTransition(storage) {
  const [row] = (await storage.jobs('retired-reset', { limit: 1 })).rows;
  if (!row) return false;
  for (const kind of [`reset-page:${row.value.operationId}`, `reset-token:${row.value.operationId}`, `reset-audit-token:${row.value.operationId}`]) {
    const page = await storage.jobs(kind, { limit: 20 });
    if (page.rows.length) { for (const item of page.rows) await storage.deleteJob(item.key); return true; }
  }
  await storage.deleteJob(`dataset-reset-initialize:${row.value.operationId}`);
  await storage.deleteJob(row.key); return true;
}

async function emptyCurrent(state, storage, sourceId, { binding = null, resetOperation = null, abandon = false } = {}) {
  const empty = await Workspace.create({ profileId: state.profileId, deviceId: state.layout.deviceId, area: state.layout.grid.area,
    bootstrapGroup: false, current: true, persist: async () => {} });
  const next = empty.state;
  next.revision = state.revision + 1;
  next.layout = { ...(resetOperation ? next.layout : reconcileSourceLayout(copy(state.layout), next)), revision: state.layout.revision + 1 };
  next.sync = { sourceId, sessionId: null, cursor: null, pendingCount: 0, localHeads: [],
    ...binding ? { dataset: copy(binding) } : {}, ...resetOperation ? { resetOperation } : {} };
  const retired = abandon ? await abandonedDatasetReset(storage) : { removedJobs: ['dataset-initialize'], jobs: [] };
  if (state.sync.dataset) retired.removedJobs.push(`checkpoint:${state.sync.dataset.plan.datasetId}`);
  await storage.save(next, state.revision, { previous: state, replaceGeneration: true, ...retired });
  return next;
}

/** Preview never changes local data or creates an empty cloud when the expected dataset is missing. */
export async function previewDatasetRejoin({ workspace, storage, fileStore, signal }) {
  const found = await new DatasetLifecycle(fileStore, storage).inspect(signal), state = workspace.state;
  requireValue(found.phase === 'ready', 'dataset-changed', t('errors.sources.datasetChanged'));
  return { profileId: state.profileId, revision: state.revision, sourceId: fileStore.sourceId, binding: found.binding,
    pending: workspace.pendingCount, drafts: Object.keys(state.drafts).length, cards: state.cards.length };
}

export async function stageDatasetRejoin({ workspace, storage, fileStore, preview, signal }) {
  const state = workspace.state;
  requireValue(preview.profileId === state.profileId && preview.sourceId === fileStore.sourceId && preview.revision === state.revision,
    'stale-restore-plan', t('errors.common.previewStale'));
  await new DatasetProtocol(fileStore, storage).assertGeneration(preview.binding.descriptor, preview.binding.plan, signal);
  signal?.throwIfAborted();
  return emptyCurrent(state, storage, fileStore.sourceId, { binding: preview.binding, abandon: true });
}

/** The confirmed reset discards this local copy once; restart never wipes edits made after its new readiness. */
export async function startDatasetReset({ state, storage, fileStore, preview = null, signal }) {
  requireValue(state.profileId.startsWith('google:') && !state.cloudRestore, 'restore-profile', t('errors.backup.cloudSignInRequired'));
  const reset = new DatasetReset(fileStore, storage);
  let job = await reset.status();
  if (!job || job.phase === 'complete') {
    requireValue(preview, 'stale-restore-plan', t('errors.common.previewStale'));
    job = await reset.begin(preview, { signal });
  }
  requireValue(!job.seeded, 'source-reset-pending', t('errors.sources.resetPending'));
  return stagePendingDatasetReset(state, storage);
}

export async function stagePendingDatasetReset(state, storage) {
  const job = await storage.getJob('dataset-reset');
  if (job && !job.seeded && job.phase !== 'complete' && state.sync.resetOperation !== job.operationId) {
    requireValue(state.format === 'work-fleet-workspace-current' && state.profileId.startsWith('google:')
      && job.kind === 'dataset-reset' && job.sourceId === `google-drive:${state.profileId.slice(7)}:appdata-v1`
      && /^[0-9a-f-]{36}$/.test(job.operationId) && job.preview?.sourceId === job.sourceId
      && ['capture', 'fence', 'initialize', 'cleanup', 'journal-cleanup'].includes(job.phase),
    'invalid-reset-job', t('errors.sources.resetJobInvalid'));
    return emptyCurrent(state, storage, job.sourceId, { resetOperation: job.operationId });
  }
  return state;
}

export async function resumeDatasetReset({ state, storage, fileStore, preview = null, signal, progress = () => {} }) {
  state = await startDatasetReset({ state, storage, fileStore, preview, signal });
  const reset = new DatasetReset(fileStore, storage); let job = await reset.status();
  while (!job.ready) {
    signal?.throwIfAborted(); job = await reset.step({ signal });
    progress({ phase: job.phase, completed: job.deleted, total: job.captured });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const workspace = new Workspace(state, (...args) => storage.save(...args));
  const sync = new DatasetSync({ workspace, storage, fileStore });
  try { await sync.sync({ force: true }); return workspace.state; }
  finally { await sync.stop({ endSession: false }); }
}
