import { copy, FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { initialGroupRecord } from './initial-group.js';
import { encodeSourceRevision } from './source-revisions.js';
import { fileLimit, sha256, validFileId, validateFile, verifyFile } from './files.js';
import { encodeInitialization, initializationId, initializationProtocol, initializationReceipt, prepareInitialization, validateInitialization } from './workspace-initialization.js';

const retryable = code => ['network', 'rate-limit', 'service-unavailable'].includes(code);

/** Durable, account-bound reset. The owner clears first, then publishes the plan and its completion proof. */
export async function resetSource(store, { job = null, saveJob = async () => {}, initialization = {}, progress = () => {},
  now = Date.now, wait = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
  const attempt = async action => {
    for (let failures = 0; ; failures++) {
      try { return await action(); }
      catch (error) { if (!retryable(error.code) || failures >= 5) throw error; await wait(1000 * 2 ** failures); }
    }
  };
  const listing = async () => {
    const ids = []; const resets = []; const tokens = new Set(); let pageToken = null;
    do {
      const page = await attempt(() => store.listFileIds({ pageToken }));
      requireValue(!page.incomplete, 'incomplete-source-scan', '來源尚未完整列舉，已停止重設。');
      requireValue(Array.isArray(page.ids) && page.ids.length <= 1000 && Array.isArray(page.resetIds),
        'invalid-source-page', '來源未提供重設身分，已停止清除。');
      requireValue(page.ids.every(validFileId) && page.resetIds.every(id => validFileId(id) && page.ids.includes(id)),
        'invalid-source-page', '來源重設身分無效，已停止清除。');
      ids.push(...page.ids); resets.push(...page.resetIds);
      pageToken = page.nextPageToken ?? null;
      if (pageToken !== null) {
        requireValue(typeof pageToken === 'string' && pageToken.length && pageToken.length <= 8192 && !tokens.has(pageToken),
          'source-page-loop', '來源分頁無效，已停止重設。'); tokens.add(pageToken);
      }
    } while (pageToken !== null);
    return { ids, resets };
  };
  const save = async next => { await saveJob(copy(next)); job = next; };
  if (!job) {
    const before = await listing();
    const id = await attempt(() => store.allocateFileId({}));
    const plan = await prepareInitialization(store.sourceId, [id], { ...initialization, origin: 'reset' });
    const markerValue = { format: 'work-fleet-reset', schema: 1, resetAt: new Date(now()).toISOString(), initialization: initializationProtocol };
    const bytes = new TextEncoder().encode(canonicalJson(markerValue));
    const marker = validateFile({ id, kind: 'reset', sha256: await sha256(bytes), size: bytes.length });
    // Validate/encode the complete plan before any remote deletion.
    requireValue(encodeInitialization(plan).length <= fileLimit('workspace'), 'invalid-initialization', '初始化計畫超過容量，尚未清除雲端。');
    await save({ sourceId: store.sourceId, marker, markerValue, previousResetIds: before.resets.sort(), plan,
      planId: await initializationId(plan), phase: 'reset', markerPublished: false, uploads: {}, deleted: 0 });
  } else job = copy(job);
  requireValue(job.sourceId === store.sourceId && ['reset', 'initialize', 'upload', 'complete'].includes(job.phase)
    && job.marker?.kind === 'reset' && Array.isArray(job.previousResetIds) && job.previousResetIds.every(validFileId)
    && typeof job.markerPublished === 'boolean' && Number.isSafeInteger(job.deleted) && job.deleted >= 0
    && job.uploads && typeof job.uploads === 'object' && !Array.isArray(job.uploads), 'invalid-reset-job', '重設工作無效或屬於其他帳號。');
  validateFile(job.marker); await validateInitialization(job.plan, store.sourceId);
  requireValue(job.plan.phase === 'prepare' && job.plan.origin === 'reset' && ['starter', 'restore'].includes(job.plan.mode)
    && encodeInitialization(job.plan).length <= fileLimit('workspace')
    && job.planId === await initializationId(job.plan) && canonicalJson(job.plan.sourceResetIds) === canonicalJson([job.marker.id])
    && job.markerValue?.format === 'work-fleet-reset' && job.markerValue.schema === 1 && job.markerValue.initialization === initializationProtocol,
    'invalid-reset-job', '重設計畫身分不符。');
  for (const [key, file] of Object.entries(job.uploads)) {
    validateFile(file);
    requireValue(key === `${file.kind}:${file.sha256}` && ['workspace', 'revision'].includes(file.kind), 'invalid-reset-job', '重設上傳保留身分無效。');
  }
  const markerBytes = new TextEncoder().encode(canonicalJson(job.markerValue)); await verifyFile(job.marker, markerBytes);
  const guard = async () => {
    const remote = await listing();
    requireValue(!remote.resets.some(id => id !== job.marker.id && !job.previousResetIds.includes(id))
      && (!job.markerPublished || remote.ids.includes(job.marker.id)), 'source-reset-superseded',
    '雲端已有其他重設或原重設標記已移除，這份舊重設工作已停止，沒有繼續清除。');
    return remote;
  };
  const create = async (file, bytes) => {
    try { const result = await attempt(() => store.createFile({ file, bytes })); requireValue(canonicalJson(validateFile(result)) === canonicalJson(file), 'upload-mismatch', '上傳身分不同。'); }
    catch (error) { if (error.code !== 'file-exists') throw error; await verifyFile(file, await attempt(() => store.readFile({ file }))); }
  };
  const publish = async (kind, bytes) => {
    const digest = await sha256(bytes); const key = `${kind}:${digest}`; let file = job.uploads[key];
    if (!file) {
      file = validateFile({ id: await attempt(() => store.allocateFileId({})), kind, sha256: digest, size: bytes.length });
      await save({ ...job, uploads: { ...job.uploads, [key]: file } });
    }
    await guard(); await create(file, bytes); return file;
  };
  await guard(); await create(job.marker, markerBytes);
  if (!job.markerPublished) await save({ ...job, markerPublished: true });
  if (job.phase === 'reset') {
    let cleared = false;
    for (let pass = 0; pass < 5; pass++) {
      const remote = await guard(); const ids = remote.ids.filter(id => id !== job.marker.id);
      if (!ids.length) { cleared = true; break; }
      for (const [index, id] of ids.entries()) {
        await attempt(() => store.deleteFile({ id }));
        await save({ ...job, deleted: job.deleted + 1 }); progress(job.deleted, job.deleted + ids.length - index - 1);
      }
    }
    if (!cleared) throw new FleetError('source-reset-incomplete', '雲端仍出現新檔案，重設尚未完成；請停止其他裝置同步後續行。');
    await save({ ...job, phase: 'initialize' });
  }
  if (job.phase === 'initialize') {
    await publish('workspace', encodeInitialization(job.plan));
    if (job.plan.mode === 'starter') {
      const root = await initialGroupRecord(store.sourceId, [job.marker.id]);
      await publish('revision', encodeSourceRevision(root, [job.marker.id]));
      await publish('workspace', encodeInitialization(await initializationReceipt(job.plan)));
      await save({ ...job, phase: 'complete' });
    } else await save({ ...job, phase: 'upload' });
  }
  return { marker: copy(job.marker), deleted: job.deleted, job: copy(job) };
}
