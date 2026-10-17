import { copy, FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { encodeRevision, revisionRecord } from './revisions.js';
import { sha256, validDigest, validFileId, validateFile, verifyFile } from './files.js';
import { resetFileIds } from './initial-group.js';
import { currentSourceRevisions, decodeSourceRevision, encodeSourceRevision } from './source-revisions.js';
import { decodeInitialization, encodeInitialization, initializationComplete, initializationId, initializationProtocol,
  initializationReceipt, prepareInitialization } from './workspace-initialization.js';
import { t } from '../i18n/index.js';

const cursorValue = value => {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 8192, 'invalid-source-page', t('errors.sources.cursorMissing'));
  return value;
};
const pageArray = value => requireValue(Array.isArray(value) && value.length <= 1000, 'invalid-source-page', t('errors.sources.pageInvalid'));
const sourceReset = () => new FleetError('source-reset', t('errors.sources.resetElsewhere'));
// Existing V1 snapshots may have a cursor/files/reservations without the optional generation field.
const sourceGeneration = sync => sync.sourceResetIds ?? (sync.cursor !== null || sync.lastSuccessfulSyncAt
  || Object.keys(sync.files || {}).length || Object.keys(sync.uploads || {}).length ? resetFileIds(sync.files) : null);
const waitingForReset = sync => Boolean(sync.initialization?.expected && !sync.initialization.activePlan
  && !Object.keys(sync.initialization.plans).length && !Object.keys(sync.initialization.receipts).length);

export { resetSource } from './source-reset.js';

/** Account-bound FileStore coordinator. FileStore owns authorization; no credential enters Workspace. */
export class FileSync {
  #workspace;
  #storage;
  #store;
  #session = null;
  #abort = new AbortController();
  #closed = false;
  #running = null;
  #now;
  #random;
  #bootstrapGroup;
  #initializationPlan;
  #failures = 0;
  #status = { phase: 'idle', pending: 0, nextAttemptAt: 0, error: null };

  constructor({ workspace, storage, fileStore, bootstrapGroup = false, initializationPlan = null, now = () => Date.now(), random = Math.random }) {
    requireValue(typeof fileStore.sourceId === 'string' && fileStore.sourceId.length > 0, 'invalid-source', t('errors.sources.sourceIdRequired'));
    this.#workspace = workspace; this.#storage = storage; this.#store = fileStore; this.#now = now; this.#random = random;
    this.#bootstrapGroup = bootstrapGroup;
    this.#initializationPlan = initializationPlan;
  }

  get status() { return copy(this.#status); }

  #check() {
    requireValue(!this.#closed && this.#session?.sourceId === this.#store.sourceId, 'stale-session', t('errors.sources.sessionEndedResponse'));
    this.#workspace.assertSyncSession(this.#session);
  }

  async #request(method, input = {}) {
    this.#check();
    const result = await this.#store[method]({ ...input, signal: this.#abort.signal });
    this.#check(); return result;
  }

  sync({ force = false } = {}) {
    if (this.#running) return this.#running;
    if (this.#closed) return Promise.reject(new FleetError('stale-session', t('errors.sources.sessionEnded')));
    if (!force && this.#now() < this.#status.nextAttemptAt) {
      return Promise.reject(new FleetError('sync-backoff', t('errors.sources.backoff'), { retryAt: this.#status.nextAttemptAt }));
    }
    this.#running = this.#run().finally(() => { this.#running = null; });
    return this.#running;
  }

  async stop({ endSession = true } = {}) {
    this.#closed = true; this.#abort.abort();
    if (this.#session && endSession) {
      try { await this.#workspace.endSync(this.#session); }
      catch (error) { if (error.code !== 'stale-session') throw error; }
    }
    this.#status = { ...this.#status, phase: 'stopped' };
  }

  async whenIdle() { await this.#running?.catch(() => {}); }

  async #run() {
    this.#status = { phase: 'syncing', pending: this.#workspace.pendingOperations.length, nextAttemptAt: 0, error: null };
    try {
      requireValue(this.#workspace.state.cloudRestore?.phase !== 'reset', 'cloud-restore-pending',
        t('errors.sources.overwriteClearing'));
      requireValue(!this.#workspace.state.sourceReset, 'source-reset-pending', t('errors.sources.resetPending'));
      if (!this.#session) {
        this.#session = await this.#workspace.beginSync(this.#store.sourceId);
        if (this.#closed) { await this.#workspace.endSync(this.#session); throw new FleetError('stale-session', t('errors.sources.sessionEnded')); }
      }
      this.#check(); await this.#pull();
      if (!await this.#initialize()) return this.#waiting();
      await this.#push(); await this.#pull();
      if (!await this.#initialize()) return this.#waiting();
      this.#check();
      await this.#workspace.completeSync(this.#session, new Date(this.#now()).toISOString());
      this.#check();
      this.#failures = 0;
      this.#status = { phase: 'idle', pending: this.#workspace.pendingOperations.length, nextAttemptAt: 0, error: null };
      return this.status;
    } catch (error) {
      const retryable = ['network', 'rate-limit', 'service-unavailable', 'page-expired', 'upload-session-expired'].includes(error.code);
      const delay = retryable ? Math.max(Math.min(60000, 1000 * 2 ** Math.min(this.#failures++, 6))
        * (0.5 + this.#random() * 0.5), Number.isFinite(error.details?.retryAfterMs) ? error.details.retryAfterMs : 0) : 0;
      this.#status = { phase: this.#closed ? 'stopped' : error.code === 'unauthorized' ? 'needs-login' : retryable ? 'backoff' : 'needs-attention',
        pending: this.#workspace.pendingOperations.length, nextAttemptAt: retryable ? this.#now() + delay : 0,
        error: { code: error.code || 'storage-error', message: error.message } };
      throw error;
    }
  }

  #waiting() {
    this.#status = { phase: 'waiting-initialization', pending: this.#workspace.pendingOperations.length, nextAttemptAt: 0, error: null };
    return this.status;
  }

  async #publishWorkspace(record) {
    const bytes = encodeInitialization(record);
    await this.#upload('workspace', await sha256(bytes), bytes);
  }

  #followsReset() {
    return waitingForReset(this.#workspace.syncState) && !this.#initializationPlan && !this.#workspace.state.cloudRestore;
  }

  async #initialize() {
    let state = this.#workspace.syncState; let initialization = state.initialization;
    const resetPlan = this.#workspace.state.cloudRestore?.resetJob?.plan;
    requireValue(!resetPlan || canonicalJson(resetPlan.sourceResetIds) === canonicalJson(resetFileIds(state.files)),
      'source-reset-superseded', t('errors.sources.overwriteSuperseded'));
    if (!initialization) {
      if (!this.#bootstrapGroup) return true;
      const mode = this.#workspace.state.revisions.length ? 'existing' : 'starter';
      const plan = await prepareInitialization(this.#store.sourceId, resetFileIds(state.files), { mode });
      await this.#publishWorkspace(plan); await this.#pull();
      state = this.#workspace.syncState; initialization = state.initialization;
    }
    const plans = Object.entries(initialization.plans);
    requireValue(plans.length <= 1, 'initialization-conflict', t('errors.sources.initializationConflict'));
    if (!plans.length) return false;
    const [id, plan] = plans[0];
    requireValue(!this.#initializationPlan || this.#initializationPlan === id, 'source-reset-superseded', t('errors.sources.initializationPlanChanged'));
    if (initialization.activePlan) {
      requireValue(initialization.activePlan === id, 'initialization-conflict', t('errors.sources.initializationMismatch')); return true;
    }
    if (await this.#workspace.activateInitialization(this.#session, id)) return true;
    const owns = this.#initializationPlan === id;
    if (!owns && !(this.#bootstrapGroup && plan.origin === 'bootstrap' && !initialization.expected)) return false;
    if (plan.mode === 'starter') {
      const present = [...this.#workspace.state.revisions, ...Object.values(initialization.incoming)];
      if (!present.some(record => record.revisionId === plan.revisions[0].id)) await this.#workspace.ensureInitialGroup(this.#session, id);
    }
    await this.#push(); await this.#pull();
    state = this.#workspace.syncState; initialization = state.initialization;
    if (!await initializationComplete(plan, [...this.#workspace.state.revisions, ...Object.values(initialization.incoming)], state.files)) return false;
    await this.#publishWorkspace(await initializationReceipt(plan)); await this.#pull();
    return this.#workspace.activateInitialization(this.#session, id);
  }

  async #receive(files, expectedCursor, cursor, deferred = null, removedFiles = []) {
    pageArray(files); files = files.map(validateFile);
    files.sort((a, b) => Number(!['reset', 'workspace'].includes(a.kind)) - Number(!['reset', 'workspace'].includes(b.kind)));
    const records = []; const controls = []; const received = []; let initializationExpected = false;
    for (const file of files) {
      const initialization = this.#workspace.syncState.initialization;
      const expecting = initialization || initializationExpected || controls.length;
      const ready = initialization?.activePlan || Object.keys(initialization?.receipts || {}).length || controls.some(record => record.phase === 'ready');
      if (!deferred && !['reset', 'workspace'].includes(file.kind) && expecting && !ready) continue;
      const bytes = await verifyFile(file, await this.#request('readFile', { file }));
      received.push(file);
      this.#check();
      if (file.kind === 'revision') {
        const transfer = decodeSourceRevision(bytes);
        if (deferred) deferred.records.push(transfer);
        else records.push(transfer);
      } else if (file.kind === 'workspace') {
        const record = await decodeInitialization(bytes, this.#store.sourceId);
        (deferred ? deferred.controls : controls).push(record);
      } else if (file.kind === 'reset') {
        const marker = parseJson(bytes);
        requireValue(marker?.format === 'work-fleet-reset' && marker.schema === 1, 'invalid-initialization', t('errors.sources.resetMarkerInvalid'));
        if (marker.initialization === initializationProtocol) {
          if (deferred) deferred.expected = true; else initializationExpected = true;
        }
      } else if (file.kind === 'attachment') await this.#storage.putAttachmentBytes(this.#session.profileId, file.sha256, bytes);
    }
    files = received;
    this.#check();
    if (files.length || removedFiles.length || cursor !== expectedCursor) {
      const known = { ...this.#workspace.syncState.files, ...Object.fromEntries(files.map(file => [file.id, file])) };
      for (const id of removedFiles) delete known[id];
      const current = currentSourceRevisions(records, known); this.#check();
      const resets = canonicalJson(resetFileIds(known));
      const currentControls = controls.filter(record => canonicalJson(record.sourceResetIds) === resets);
      const stage = Boolean(this.#workspace.syncState.initialization || currentControls.length || initializationExpected);
      await this.#workspace.receiveRevisions(current, { session: this.#session, expectedCursor, cursor, files,
        workspaceRecords: currentControls, initializationExpected, stage, removedFiles });
    }
  }

  async #fullScan(generation = sourceGeneration(this.#workspace.syncState)) {
    const baseline = cursorValue(await this.#request('getStartCursor'));
    let pageToken = null; const tokens = new Set(); const found = new Set();
    const deferred = { records: [], controls: [], expected: false }; const descriptors = []; let marked = false;
    do {
      const page = await this.#request('listFiles', { pageToken }); pageArray(page.files);
      requireValue(!page.incomplete, 'incomplete-source-scan', t('errors.sources.scanIncomplete'));
      if (generation && !this.#followsReset()
        && page.files.some(file => file?.kind === 'reset' && !generation.includes(file.id))) throw sourceReset();
      marked ||= page.files.some(file => file?.kind === 'reset');
      descriptors.push(...page.files.map(validateFile));
      for (const file of page.files) found.add(file.id);
      pageToken = page.nextPageToken ?? null;
      if (pageToken !== null) {
        cursorValue(pageToken);
        requireValue(!tokens.has(pageToken), 'source-page-loop', t('errors.sources.pageLoop')); tokens.add(pageToken);
      }
    } while (pageToken !== null);
    const missing = Object.keys(this.#workspace.syncState.files || {}).filter(id => !found.has(id));
    if (missing.length && marked && this.#followsReset()) {
      await this.#workspace.receiveRevisions([], { session: this.#session, expectedCursor: null, cursor: null, removedFiles: missing });
    }
    // Learn all control records first, even when their descriptors occur after old data in the listing.
    const controlsFirst = descriptors.filter(file => ['reset', 'workspace'].includes(file.kind))
      .sort((a, b) => Number(a.kind !== 'reset') - Number(b.kind !== 'reset'));
    for (let offset = 0; offset < controlsFirst.length; offset += 1000) await this.#receive(controlsFirst.slice(offset, offset + 1000), null, null);
    const initialization = this.#workspace.syncState.initialization;
    const mayRead = !initialization || initialization.activePlan || Object.keys(initialization.receipts).length;
    if (mayRead) {
      const data = descriptors.filter(file => !['reset', 'workspace'].includes(file.kind));
      for (let offset = 0; offset < data.length; offset += 1000) await this.#receive(data.slice(offset, offset + 1000), null, null, deferred);
    }
    for (const file of Object.values(this.#workspace.syncState.files || {})) {
      // Known files gone next to a reset marker were cleared on purpose; without one their absence stays an error.
      if (!found.has(file.id) && marked) throw sourceReset();
      requireValue(found.has(file.id), 'source-file-missing', t('errors.sources.fileMissing'));
    }
    const current = currentSourceRevisions(deferred.records, this.#workspace.syncState.files);
    const resets = canonicalJson(resetFileIds(this.#workspace.syncState.files));
    const controls = deferred.controls.filter(record => canonicalJson(record.sourceResetIds) === resets);
    this.#check(); await this.#workspace.receiveRevisions(current, { session: this.#session, expectedCursor: null, cursor: baseline,
      workspaceRecords: controls, initializationExpected: deferred.expected,
      initializationScanned: true,
      stage: Boolean(controls.length || deferred.expected || this.#workspace.syncState.initialization) });
  }

  async #pull() {
    if (this.#workspace.syncState.cursor === null) await this.#fullScan();
    let restarted = false; const tokens = new Set();
    while (true) {
      const cursor = this.#workspace.syncState.cursor;
      const generation = sourceGeneration(this.#workspace.syncState);
      let page;
      try { page = await this.#request('listChanges', { cursor }); }
      catch (error) {
        if (error.code !== 'cursor-expired' || restarted) throw error;
        this.#check();
        await this.#workspace.receiveRevisions([], { session: this.#session, expectedCursor: cursor, cursor: null });
        await this.#fullScan(generation); restarted = true; tokens.clear(); continue;
      }
      pageArray(page.changes);
      const known = new Set(Object.values(this.#workspace.syncState.files || {}).map(file => file.id));
      const files = []; const removedKnown = [];
      for (const change of page.changes) {
        requireValue(change && validFileId(change.id) && typeof change.removed === 'boolean', 'invalid-source-page', t('errors.sources.changeInvalid'));
        // A file this device never received leaves nothing behind when it goes; a known one going needs the user.
        if (change.removed) { if (known.has(change.id)) removedKnown.push(change.id); continue; }
        requireValue(change.file?.id === change.id, 'invalid-source-page', t('errors.sources.changeFileMismatch'));
        files.push(validateFile(change.file));
      }
      // A reset writes its marker before deleting, so the marker reaches this device ahead of the removals.
      if (files.some(file => file.kind === 'reset' && !known.has(file.id))
        && generation !== null && !this.#followsReset()) throw sourceReset();
      requireValue(!removedKnown.length || this.#followsReset(), 'source-file-missing', t('errors.sources.fileRemoved'));
      const next = page.nextCursor ?? null;
      requireValue(next === null || page.cursor == null, 'invalid-source-page', t('errors.sources.cursorMixed'));
      const target = cursorValue(next ?? page.cursor);
      if (next !== null) {
        requireValue(target !== cursor && !tokens.has(target), 'source-page-loop', t('errors.sources.pageLoop')); tokens.add(target);
      }
      await this.#receive(files, cursor, target, null, removedKnown);
      if (next === null) {
        if (this.#workspace.syncState.initialization?.refreshNeeded) {
          await this.#workspace.receiveRevisions([], { session: this.#session, expectedCursor: target, cursor: null });
          await this.#fullScan(generation); continue;
        }
        return;
      }
    }
  }

  async #upload(kind, key, bytes) {
    this.#check(); const operation = `${kind}:${key}`;
    let upload = this.#workspace.uploadState(this.#session, operation);
    if (upload?.complete) return;
    const digest = await sha256(bytes); this.#check();
    if (!upload) {
      const id = await this.#request('allocateFileId');
      upload = await this.#workspace.reserveUpload(this.#session, key, { id, kind, sha256: digest, size: bytes.byteLength });
    }
    requireValue(upload.file.sha256 === digest && upload.file.size === bytes.byteLength, 'upload-mismatch', t('errors.sources.retryMismatch'));
    this.#check();
    try {
      const result = validateFile(await this.#request('createFile', { file: upload.file, bytes }));
      requireValue(canonicalJson(result) === canonicalJson(upload.file), 'upload-mismatch', t('errors.sources.uploadResponseMismatch'));
    } catch (error) {
      if (error.code !== 'file-exists') throw error;
      const remote = await verifyFile(upload.file, await this.#request('readFile', { file: upload.file }));
      requireValue(remote.length === bytes.length && remote.every((byte, index) => byte === bytes[index]),
        'upload-mismatch', t('errors.sources.existingFileDiffers'));
    }
    this.#check(); await this.#workspace.completeUpload(this.#session, operation, upload.file.id);
  }

  async #push() {
    for (const operation of this.#workspace.pendingOperations) {
      this.#check();
      for (const attachment of operation.value.content?.attachments || []) {
        requireValue(validDigest(attachment.id), 'attachment-address', t('errors.sources.attachmentAddress'));
        if (this.#workspace.uploadState(this.#session, `attachment:${attachment.id}`)?.complete) continue;
        const blob = await this.#storage.getAttachment(this.#session.profileId, attachment.id); this.#check();
        requireValue(blob instanceof Blob, 'missing-attachment', t('errors.sources.attachmentMissing'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        requireValue(await sha256(bytes) === attachment.id, 'attachment-integrity', t('errors.sources.attachmentIntegrity'));
        await this.#upload('attachment', attachment.id, bytes);
      }
      const record = revisionRecord(operation.kind, operation.value, operation.parents);
      let bytes = encodeSourceRevision(record, resetFileIds(this.#workspace.syncState.files));
      const reserved = this.#workspace.uploadState(this.#session, `revision:${operation.operationId}`);
      if (reserved) {
        // A previously reserved V1 upload keeps its original bytes, including an unscoped file reserved before this field existed.
        const portable = encodeRevision(record);
        if (reserved.file.sha256 === await sha256(portable)) bytes = portable;
      }
      await this.#upload('revision', operation.operationId, bytes);
    }
  }
}
