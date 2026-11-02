import { copy, FleetError, requireValue, safeKey } from '../core/contracts.js';
import { sha256, validDigest } from '../sources/files.js';
import { canonicalJson } from '../sources/json.js';
import { createBackup } from './payload.js';
import { BACKUP_LIMITS, checkCancelled } from './archive.js';
import { validateEncryptedBackup } from './encryption.js';
import { schemas, requireSchemaVersion } from '../core/schema.js';
import { t } from '../i18n/index.js';

const DAY = 24 * 60 * 60 * 1000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const reference = value => safeKey(value) && value.length <= 256;
const validJob = job => job && uuidPattern.test(job.id) && uuidPattern.test(job.scheduleId) && uuidPattern.test(job.policyId)
  && reference(job.destinationId) && job.name === `work-fleet-auto-${job.id}.zip`
  && integer(job.sourceRevision) && integer(job.createdAt) && typeof job.encrypted === 'boolean'
  && validDigest(job.sha256) && integer(job.size) && job.size > 0 && job.size <= BACKUP_LIMITS.encryptedBytes;

export function validateAutomaticJob(job) {
  requireValue(validJob(job), 'invalid-backup-job', t('errors.backup.jobInvalid')); return job;
}

export function validateAutomaticState(state, profileId) {
  requireSchemaVersion(state, 'journal', { code: 'unsupported-backup-journal' });
  requireValue(state && state.profileId === profileId && integer(state.revision)
    && typeof state.enabled === 'boolean' && typeof state.paused === 'boolean' && integer(state.failures) && integer(state.nextAttemptAt)
    && Array.isArray(state.inventory) && state.inventory.length <= 10000
    && state.inventory.every(item => validJob(item) && ['verified', 'unconfirmed'].includes(item.status))
    && (!state.pending || validJob(state.pending)), 'invalid-backup-journal', t('errors.backup.journalInvalid'));
  const settings = state.settings;
  requireValue(settings === null || (uuidPattern.test(settings.scheduleId) && uuidPattern.test(settings.policyId) && reference(settings.destinationId)
    && typeof settings.destinationName === 'string' && settings.destinationName.length <= 1024
    && typeof settings.encrypted === 'boolean' && (settings.encrypted ? reference(settings.keyId) : settings.keyId === null)
    && Number.isInteger(settings.keep) && settings.keep >= 1 && settings.keep <= 90),
  'invalid-backup-journal', t('errors.backup.journalSettingsInvalid'));
  requireValue((!state.enabled || settings) && (!state.lastSuccess || (validJob(state.lastSuccess) && integer(state.lastSuccess.savedAt)))
    && (!state.lastFailure || (typeof state.lastFailure.code === 'string' && state.lastFailure.code.length <= 128
      && typeof state.lastFailure.message === 'string' && state.lastFailure.message.length <= 2048 && integer(state.lastFailure.failedAt)))
    && new Set(state.inventory.map(item => item.id)).size === state.inventory.length
    && (!state.pending || !state.inventory.some(item => item.id === state.pending.id)),
  'invalid-backup-journal', t('errors.backup.journalIdentityInvalid'));
  return state;
}

/** One instance per leased profile. The journal is separate from content so backups cannot trigger themselves. */
export class AutomaticBackup {
  #workspace; #storage; #journal; #files; #vault; #flush; #now; #uuid; #appVersion; #listeners = new Set();
  #state; #persisted = false; #tail = Promise.resolve(); #running = null; #controller = null;
  #phase = 'idle'; #transientError = null;
  #runtimePaused = false; #issued = new Set();

  constructor({ workspace, storage, journal, files, vault = null, flush = async () => {}, now = () => Date.now(),
    uuid = () => crypto.randomUUID(), onStatus = () => {}, appVersion = undefined }) {
    this.#appVersion = appVersion;
    this.#workspace = workspace; this.#storage = storage; this.#journal = journal; this.#files = files;
    this.#vault = vault; this.#flush = flush; this.#now = now; this.#uuid = uuid; this.#listeners.add(onStatus);
    this.#state = { schemaVersion: schemas.journal, profileId: workspace.state.profileId, revision: 0, enabled: false, paused: false,
      settings: null, inventory: [], pending: null, lastSuccess: null, lastFailure: null, failures: 0, nextAttemptAt: 0 };
  }

  get state() { return copy(this.#state); }
  get status() {
    return { ...this.state, paused: this.#runtimePaused || this.#state.paused, phase: this.#phase, error: this.#transientError || this.#state.lastFailure,
      canEncrypt: this.#vault?.available === true, canCreate: this.#files.canCreate === true, canPrune: this.#files.canPrune === true };
  }
  subscribe(listener) { this.#listeners.add(listener); listener(this.status); return () => this.#listeners.delete(listener); }
  #announce() { for (const listener of this.#listeners) { try { listener(this.status); } catch { /* UI observers cannot change durability. */ } } }
  #pause(error) {
    this.#runtimePaused = true; this.#phase = 'idle';
    this.#transientError = { code: String(error.code || 'backup-journal-unavailable').slice(0, 128),
      message: String(error.message || t('errors.backup.journalUnavailable')).slice(0, 2048), failedAt: Date.now() };
    this.#announce();
  }
  #clock() { const value = this.#now(); requireValue(integer(value), 'backup-clock', t('errors.backup.clockInvalid')); return value; }
  #fresh() {
    const id = this.#uuid(); requireValue(uuidPattern.test(id) && !this.#issued.has(id) && id !== this.#state.settings?.scheduleId
      && id !== this.#state.settings?.policyId
      && id !== this.#state.pending?.id && !this.#state.inventory.some(item => item.id === id || item.scheduleId === id),
    'backup-id-collision', t('errors.backup.jobIdCollision')); this.#issued.add(id); return id;
  }
  #queue(work) {
    const operation = this.#tail.then(async () => {
      try { await this.#reload(); }
      catch (error) {
        this.#pause(error); throw error;
      }
      if (this.#runtimePaused) { this.#runtimePaused = false; this.#transientError = null; }
      return work();
    });
    this.#tail = operation.catch(() => {}); return operation;
  }
  async #reload() {
    const state = await this.#journal.load(this.#state.profileId);
    if (state) { this.#state = copy(validateAutomaticState(state, this.#state.profileId)); this.#persisted = true; }
    else requireValue(!this.#persisted, 'backup-journal-missing', t('errors.backup.journalMissing'));
    requireValue(this.#workspace.state.profileId === this.#state.profileId, 'backup-profile', t('errors.common.backupProfileChanged'));
  }
  async #save(patch) {
    const expected = this.#persisted ? this.#state.revision : null;
    const next = validateAutomaticState({ ...this.#state, ...copy(patch), revision: expected === null ? 0 : expected + 1 }, this.#state.profileId);
    try { await this.#journal.save(next, expected); }
    catch (error) {
      const durable = await this.#journal.load(next.profileId);
      if (!durable || canonicalJson(durable) !== canonicalJson(next)) throw error;
    }
    this.#state = next; this.#persisted = true; this.#announce();
  }
  load() { return this.#queue(() => { this.#announce(); return this.status; }); }

  configure(settings) {
    settings = copy(settings);
    return this.#queue(async () => {
      requireValue(settings && Object.keys(settings).every(key => ['destinationId', 'destinationName', 'encrypted', 'keyId', 'keep'].includes(key)),
        'invalid-backup-setting', t('errors.backup.settingUnknown'));
      requireValue(this.#files.canCreate === true, 'backup-create-unavailable', t('errors.backup.createUnavailable'));
      requireValue(!settings.encrypted || this.#vault?.available === true, 'backup-vault-unavailable', t('errors.backup.vaultUnavailable'));
      const sameDestination = settings.destinationId === this.#state.settings?.destinationId;
      const next = { ...settings, keyId: settings.encrypted ? settings.keyId : null,
        scheduleId: sameDestination ? this.#state.settings.scheduleId : this.#fresh(), policyId: this.#fresh() };
      const inventory = [...this.#state.inventory];
      // Changing settings never deletes an unconfirmed file or starts managing a former location.
      if (this.#state.pending) inventory.push({ ...this.#state.pending, status: 'unconfirmed' });
      await this.#save({ enabled: true, paused: false, settings: next, inventory, pending: null, failures: 0, nextAttemptAt: 0, lastFailure: null });
      return this.status;
    });
  }

  disable() {
    this.cancel();
    return this.#queue(async () => { await this.#save({ enabled: false }); this.#phase = 'idle'; this.#announce(); return this.status; });
  }
  cancel() { this.#controller?.abort(); }
  whenIdle() { return this.#tail; }

  run({ force = false, signal } = {}) {
    if (this.#running) return this.#running;
    const controller = new AbortController(); this.#controller = controller;
    const relay = () => controller.abort(); signal?.addEventListener('abort', relay, { once: true }); if (signal?.aborted) relay();
    this.#phase = 'queued';
    const operation = this.#queue(async () => {
      if (!this.#state.enabled) return { kind: 'disabled' };
      if (!force && this.#state.paused) return { kind: 'paused' };
      if (!force && this.#clock() < this.#state.nextAttemptAt) return { kind: 'backoff', nextAttemptAt: this.#state.nextAttemptAt };
      this.#transientError = null; this.#phase = 'running'; this.#announce();
      try { return await this.#perform(force, controller.signal); }
      catch (error) {
        // Reload first: a journal commit can be durable even if its acknowledgement was lost.
        try { await this.#reload(); } catch (journalError) { this.#pause(journalError); throw journalError; }
        const failedAt = this.#clock(); const failures = Math.min(this.#state.failures + 1, 20);
        const code = String(error.code || (error.name === 'NotAllowedError' ? 'backup-permission' : 'backup-failed')).slice(0, 128);
        const failure = { code, failedAt, message: String(error.message || t('errors.backup.automaticFailed')).slice(0, 2048) };
        this.#transientError = failure;
        try {
          await this.#save({ failures, lastFailure: failure, paused: ['backup-permission', 'backup-key-unavailable', 'backup-vault-unavailable',
            'backup-create-unavailable', 'backup-directory-changed', 'backup-directory', 'backup-filesystem', 'unsupported-backup-encryption'].includes(code),
            nextAttemptAt: failedAt + Math.min(3600000, 60000 * 2 ** (failures - 1)) });
        } catch (journalError) { this.#pause(journalError); throw journalError; }
        throw error;
      }
    });
    this.#running = operation;
    this.#announce();
    const settled = () => {
      signal?.removeEventListener('abort', relay); if (this.#controller === controller) this.#controller = null;
      this.#running = null; this.#phase = 'idle'; this.#announce();
    };
    operation.then(settled, settled); return operation;
  }

  async #publish(job) {
    await this.#save({ pending: null, inventory: [...this.#state.inventory, { ...job, status: 'verified' }],
      lastSuccess: { ...job, savedAt: this.#clock() }, lastFailure: null, paused: false, failures: 0, nextAttemptAt: 0 });
  }
  async #recover(signal) {
    const job = this.#state.pending; if (!job) return false;
    let bytes;
    try { bytes = await this.#files.read({ ...copy(job), profileId: this.#state.profileId, signal }); }
    catch (error) {
      if (!['backup-file-unowned', 'backup-file-changed'].includes(error.code)) throw error;
      await this.#save({ pending: null, inventory: [...this.#state.inventory, { ...job, status: 'unconfirmed' }] }); return false;
    }
    checkCancelled(signal);
    if (bytes !== null && bytes.length === job.size && await sha256(bytes) === job.sha256) {
      await this.#publish(job); return true;
    }
    await this.#save({ pending: null, inventory: bytes === null ? this.#state.inventory
      : [...this.#state.inventory, { ...job, status: 'unconfirmed' }] });
    return false;
  }
  async #prune(signal) {
    if (signal.aborted || this.#files.canPrune !== true) return;
    const settings = this.#state.settings;
    if (this.#state.lastSuccess?.scheduleId !== settings.scheduleId) return;
    const owned = this.#state.inventory.filter(item => item.status === 'verified' && item.scheduleId === settings.scheduleId
      && item.destinationId === settings.destinationId);
    const obsolete = owned.slice(0, Math.max(0, owned.length - settings.keep));
    if (obsolete.length) {
      const latest = this.#state.lastSuccess;
      let bytes;
      try { bytes = await this.#files.read({ ...copy(latest), profileId: this.#state.profileId, signal }); }
      catch (error) {
        if (!['backup-file-unowned', 'backup-file-changed'].includes(error.code)) throw error;
        throw new FleetError('backup-latest-missing', t('errors.backup.latestReplaced'));
      }
      requireValue(bytes !== null && bytes.length === latest.size && await sha256(bytes) === latest.sha256,
        'backup-latest-missing', t('errors.backup.latestMissing'));
    }
    for (const job of obsolete) {
      checkCancelled(signal);
      requireValue(job.id !== this.#state.lastSuccess.id, 'backup-retention', t('errors.backup.retentionLatest'));
      // Adapter must recheck size/hash and exact authorized destination before deleting this single owned file.
      await this.#files.remove({ ...copy(job), profileId: this.#state.profileId, signal });
      await this.#save({ inventory: this.#state.inventory.filter(item => item.id !== job.id) });
    }
  }
  async #perform(force, signal) {
    checkCancelled(signal);
    requireValue(this.#files.canCreate === true, 'backup-create-unavailable', t('errors.backup.createPaused'));
    if (await this.#recover(signal)) { await this.#prune(signal); return { kind: 'recovered', saved: copy(this.#state.lastSuccess) }; }
    const previous = this.#state.lastSuccess; const now = this.#clock();
    if (!force && this.#state.lastFailure?.code !== 'backup-latest-missing' && previous?.policyId === this.#state.settings.policyId
      && (now < previous.savedAt + DAY || this.#workspace.state.revision === previous.sourceRevision)) {
      await this.#prune(signal); return { kind: 'not-due' };
    }
    await this.#flush(); checkCancelled(signal);
    const settings = copy(this.#state.settings); const snapshot = this.#workspace.state;
    requireValue(snapshot.profileId === this.#state.profileId, 'backup-profile', t('errors.common.backupProfileChanged'));
    const id = this.#fresh(); const backup = await createBackup({ workspace: this.#workspace, snapshot, storage: this.#storage, appVersion: this.#appVersion,
      uuid: () => id, now: () => new Date(now), signal });
    if (settings.encrypted) {
      requireValue(this.#vault?.available === true && typeof this.#vault.encrypt === 'function',
        'backup-vault-unavailable', t('errors.backup.vaultPaused'));
      const plaintext = backup.bytes;
      try {
        backup.bytes = await this.#vault.encrypt({ profileId: snapshot.profileId, keyId: settings.keyId, bytes: plaintext, signal });
        await validateEncryptedBackup(backup.bytes, { signal }); backup.encrypted = true;
      } finally { plaintext.fill(0); }
    }
    const job = { id, scheduleId: settings.scheduleId, policyId: settings.policyId, destinationId: settings.destinationId,
      name: `work-fleet-auto-${id}.zip`, sourceRevision: snapshot.revision, createdAt: now,
      encrypted: backup.encrypted, sha256: await sha256(backup.bytes), size: backup.bytes.length };
    checkCancelled(signal); await backup.verify?.(); await this.#save({ pending: job });
    const result = await this.#files.create({ ...copy(job), profileId: snapshot.profileId, bytes: backup.bytes, signal });
    requireValue(result?.saved === true && typeof result.receipt === 'string' && result.receipt.length > 0,
      'backup-not-saved', t('errors.backup.automaticNotSaved'));
    // The host's irreversible close/readback phase is authoritative even if cancel arrived too late.
    await this.#publish(job); await this.#prune(signal);
    return { kind: 'saved', saved: copy(this.#state.lastSuccess) };
  }
}
