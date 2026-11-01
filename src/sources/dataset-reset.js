import { copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { sha256, validFileId, validateFile, verifyFile } from './files.js';
import { DatasetLifecycle } from './dataset-lifecycle.js';
import { DatasetProtocol, listDatasetObjects } from './dataset-protocol.js';
import { t } from '../i18n/index.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const superseded = condition => requireValue(condition, 'source-reset-superseded', t('errors.sources.resetSuperseded'));
const invalid = condition => requireValue(condition, 'invalid-reset-job', t('errors.sources.resetJobInvalid'));
const missing = error => ['file-missing', 'source-file-missing'].includes(error.code);
const bytesOf = value => new TextEncoder().encode(canonicalJson(value));
const idsOf = files => files.map(file => file.id).sort();

/** Explicit reset: capture old IDs before publishing any new data, then retire only captured leaf files. */
export class DatasetReset {
  #store; #journal; #protocol; #running = null;
  constructor(store, journal) { this.#store = store; this.#journal = journal; this.#protocol = new DatasetProtocol(store, journal); }
  async preview(signal) {
    const [fences, datasets] = await Promise.all([
      listDatasetObjects(this.#store, { scope: 'fences' }, { signal, limit: 16 }),
      listDatasetObjects(this.#store, { scope: 'datasets' }, { signal, limit: 16 }),
    ]);
    return { sourceId: this.#store.sourceId, fences: idsOf(fences), datasets: idsOf(datasets) };
  }
  async begin(preview, { starter = true, signal } = {}) {
    invalid(preview?.sourceId === this.#store.sourceId && typeof starter === 'boolean');
    superseded(same(preview, await this.preview(signal)));
    const pending = await this.#journal.getJob('dataset-reset');
    requireValue(!pending || pending.phase === 'complete', 'source-reset-pending', t('errors.sources.resetPending'));
    const markerValue = { format: 'work-fleet-reset', schema: 1, resetAt: new Date().toISOString(), initialization: 'workspace-init-v1' };
    const bytes = bytesOf(markerValue), marker = validateFile({ id: await this.#store.allocateFileId({ signal }),
      kind: 'reset', sha256: await sha256(bytes), size: bytes.length });
    const job = { kind: 'dataset-reset', operationId: crypto.randomUUID(), sourceId: this.#store.sourceId,
      phase: 'capture', starter, preview: copy(preview), marker, markerValue, markerPublished: false,
      pageToken: null, pageIndex: 0, captured: 0, deleted: 0, retainedFolders: 0, seenFences: [], binding: null, ready: false };
    await this.#journal.putJob('dataset-reset', job); return copy(job);
  }
  status() { return this.#journal.getJob('dataset-reset'); }
  step({ signal } = {}) {
    if (this.#running) return this.#running;
    this.#running = this.#step(signal).finally(() => { this.#running = null; }); return this.#running;
  }
  async #step(signal) {
    let job = await this.status();
    if (!job || job.phase === 'complete') return job;
    invalid(job.kind === 'dataset-reset' && job.sourceId === this.#store.sourceId);
    validateFile(job.marker); await verifyFile(job.marker, bytesOf(job.markerValue));
    const initializeKey = `dataset-reset-initialize:${job.operationId}`;
    const pageKind = `reset-page:${job.operationId}`, tokenKind = `reset-token:${job.operationId}`;
    const save = async patch => { job = { ...job, ...patch }; await this.#journal.putJob('dataset-reset', job); };
    const guard = async () => {
      signal?.throwIfAborted();
      const remote = await this.preview(signal), own = await this.#journal.getJob(initializeKey);
      superseded(remote.fences.every(id => id === job.marker.id || job.preview.fences.includes(id))
        && remote.datasets.every(id => job.preview.datasets.includes(id) || id === (own?.binding ?? job.binding)?.descriptor.id));
      if (job.markerPublished) {
        superseded(remote.fences.includes(job.marker.id));
        try { await verifyFile(job.marker, await this.#store.readFile({ file: job.marker, signal })); }
        catch (error) { if (missing(error)) superseded(false); throw error; }
      } else superseded(job.preview.fences.every(id => remote.fences.includes(id)));
      if (job.binding) {
        try {
          const { descriptor, plan } = job.binding;
          superseded(same(await this.#protocol.read(descriptor, signal), plan));
          const root = await this.#store.getObject({ id: plan.rootId, signal });
          superseded(root.kind === 'dataset-root' && root.datasetId === plan.datasetId && root.parentId === 'appDataFolder');
          const ready = await this.#store.getObject({ id: plan.readyId, signal });
          const receipt = await this.#protocol.read(ready, signal);
          superseded(ready.parentId === plan.rootId && receipt.kind === 'ready'
            && same(receipt.descriptor, { id: descriptor.id, sha256: descriptor.sha256 }));
        } catch (error) { if (missing(error)) superseded(false); throw error; }
      }
    };
    await guard();
    if (job.phase === 'capture') {
      const page = await this.#store.listObjects({ query: { scope: 'legacy' }, pageToken: job.pageToken, signal });
      invalid(Array.isArray(page.files) && page.files.length <= 100 && !page.incomplete
        && page.files.every(file => validFileId(file.id) && typeof file.folder === 'boolean' && file.id !== job.marker.id));
      const next = page.nextPageToken ?? null;
      invalid(next === null || typeof next === 'string' && next.length > 0 && next.length <= 8192 && next !== job.pageToken);
      const writes = [];
      if (next) {
        const key = `${tokenKind}:${await sha256(new TextEncoder().encode(next))}`;
        invalid(!await this.#journal.getJob(key)); writes.push({ key, value: { kind: tokenKind } });
      }
      const files = page.files.filter(file => !file.folder).map(file => ({ id: file.id, kind: file.kind }));
      const seenFences = [...new Set([...job.seenFences, ...files.filter(file => job.preview.fences.includes(file.id)).map(file => file.id)])].sort();
      if (!next) invalid(same(seenFences, job.preview.fences));
      job = { ...job, pageToken: next, pageIndex: job.pageIndex + 1, captured: job.captured + files.length,
        retainedFolders: job.retainedFolders + page.files.length - files.length, seenFences, phase: next ? 'capture' : 'fence' };
      if (files.length) writes.push({ key: `${pageKind}:${job.pageIndex}`, value: { kind: pageKind, files } });
      writes.push({ key: 'dataset-reset', value: job });
      await this.#journal.putJobs(writes); return copy(job);
    }
    if (job.phase === 'fence') {
      const bytes = bytesOf(job.markerValue);
      try { await this.#store.createFile({ file: job.marker, bytes, signal }); }
      catch (error) { if (!['file-exists', 'network', 'native-outcome-unknown'].includes(error.code)) throw error; }
      await verifyFile(job.marker, await this.#store.readFile({ file: job.marker, signal }));
      await save({ markerPublished: true, phase: 'initialize' }); return copy(job);
    }
    if (job.phase === 'initialize') {
      const binding = await new DatasetLifecycle(this.#store, this.#journal).initialize({ key: initializeKey,
        fenceId: job.marker.id, starter: job.starter, allowExisting: true, signal, guard });
      await save({ binding, phase: 'cleanup' }); return copy(job);
    }
    if (job.phase === 'cleanup') {
      if (!job.ready) {
        const old = (await this.preview(signal)).fences.find(id => job.seenFences.includes(id));
        if (old) { await guard(); await this.#store.deleteFile({ id: old, signal }); return copy(job); }
        await this.#protocol.assertGeneration(job.binding.descriptor, job.binding.plan, signal);
        await save({ ready: true }); return copy(job);
      }
      const [row] = (await this.#journal.jobs(pageKind, { limit: 1 })).rows;
      if (row) {
        const targets = row.value.files.slice(0, 20);
        for (const file of targets) { await guard(); await this.#store.deleteFile({ id: file.id, signal }); }
        const files = row.value.files.slice(targets.length);
        job = { ...job, deleted: job.deleted + targets.length };
        // An empty page is retained until its receipt commits, so lost replies never skip captured IDs.
        await this.#journal.putJobs([{ key: row.key, value: { ...row.value, files } }, { key: 'dataset-reset', value: job }]);
        if (!files.length) await this.#journal.deleteJob(row.key);
        return copy(job);
      }
      await guard(); await this.#protocol.assertGeneration(job.binding.descriptor, job.binding.plan, signal);
      await save({ phase: 'journal-cleanup' }); return copy(job);
    }
    if (job.phase === 'journal-cleanup') {
      for (const row of (await this.#journal.jobs(tokenKind, { limit: 100 })).rows) await this.#journal.deleteJob(row.key);
      if ((await this.#journal.jobs(tokenKind, { limit: 1 })).rows.length) return copy(job);
      await guard(); await this.#protocol.assertGeneration(job.binding.descriptor, job.binding.plan, signal);
      await this.#journal.deleteJob(initializeKey); await save({ phase: 'complete' }); return copy(job);
    }
    invalid(false);
  }
}
