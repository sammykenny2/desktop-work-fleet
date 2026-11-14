import { copy, membershipKey, requireValue } from '../core/contracts.js';
import { checkZOrder, maxOrder } from './stacking.js';
import { t } from '../i18n/index.js';

const key = 'desktop-layout-batch';
const invalid = value => requireValue(value, 'invalid-layout-batch', t('errors.core.layoutBatchPending'));
const validate = job => {
  if (!job) return null;
  invalid(job.schemaVersion === 1 && typeof job.id === 'string' && ['pending', 'done', 'abandoned'].includes(job.status));
  checkZOrder(job.version);
  if (job.status === 'pending') invalid(Array.isArray(job.steps) && job.steps.every(step => typeof step.owner === 'string'
    && Number.isSafeInteger(step.revision) && step.before?.schemaVersion === 1
    && step.after?.schemaVersion === 1 && typeof step.membership === 'string'));
  return job;
};

/** A single bounded layout batch, not a content transaction across databases. */
export class LayoutBatchJournal {
  #profiles; #desk; #pending = null; #loaded = false; #tail = Promise.resolve();
  constructor(profiles, desk) { this.#profiles = profiles; this.#desk = desk; }
  get pending() { return Boolean(this.#pending); }
  get blocked() { return !this.#loaded || this.pending; }
  before(owner) { return this.#pending?.steps.find(step => step.owner === owner)?.before ?? null; }
  beforeDesk(current) {
    const before = this.#pending?.desk?.before;
    if (!before) return current;
    const shown = copy(current);
    for (const [key, value] of Object.entries(before)) { if (value === null) delete shown[key]; else shown[key] = copy(value); }
    return shown;
  }
  whenIdle() { return this.#tail; }
  #queue(work) { const result = this.#tail.then(work); this.#tail = result.catch(() => {}); return result; }
  async #load() {
    const jobs = await Promise.all(this.#profiles.map(async profile => validate(await profile.storage.getControl(key))));
    const latest = jobs.filter(Boolean).sort((a, b) => a.version.localeCompare(b.version)
      || Number(a.status !== 'pending') - Number(b.status !== 'pending')).at(-1);
    this.#pending = latest?.status === 'pending' ? latest : null; this.#loaded = true;
    return latest;
  }
  async #save(job) {
    const results = await Promise.allSettled(this.#profiles.map(profile => profile.storage.putControl(key, copy(job))));
    const canonical = Math.max(0, this.#profiles.findIndex(profile => profile.id === 'local'));
    if (results[canonical].status === 'rejected') throw results[canonical].reason;
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
  }
  async #finish(status) {
    const { id, version, schemaVersion } = this.#pending;
    await this.#save({ id, version, schemaVersion, status }); this.#pending = null;
  }
  async #resume() {
    if (!this.#loaded) await this.#load();
    const job = this.#pending; if (!job) return false;
    try {
      // Ensure the always-open device copy holds the intent before applying even the first owner's step.
      try { await this.#save(job); } catch (error) { this.#loaded = false; throw error; }
      for (const step of job.steps) {
        const profile = this.#profiles.find(item => item.id === step.owner);
        requireValue(profile, 'layout-batch-pending', t('errors.core.layoutBatchPending'));
        await profile.workspace.layout.commitBatch(job.id, step, () => profile.workspace.working);
      }
      if (job.desk && this.#desk.state.layoutBatchId !== job.id) {
        await this.#desk.update(draft => {
          requireValue(Object.keys(job.desk.before).every(field => JSON.stringify(draft[field] ?? null) === JSON.stringify(job.desk.before[field])),
            'stale-layout-batch', t('errors.core.arrangePlanStale'));
          Object.assign(draft, copy(job.desk.after), { layoutBatchId: job.id });
          for (const field of job.desk.unset ?? []) delete draft[field];
        });
      }
      await this.#finish('done'); return true;
    } catch (error) {
      if (error.code === 'stale-layout-batch') await this.#finish('abandoned');
      throw error;
    }
  }
  recover() { return this.#queue(() => this.#resume()); }
  run(steps, desk = null, id = crypto.randomUUID()) {
    steps = copy(steps); desk = copy(desk);
    return this.#queue(async () => {
      await this.#resume();
      // Preflight all owners before recording an intent or changing any placement.
      for (const step of steps) {
        const profile = this.#profiles.find(item => item.id === step.owner);
        requireValue(profile && profile.workspace.layout.state.revision === step.revision
          && membershipKey(profile.workspace.working, profile.workspace.layout.state) === step.membership,
        'stale-plan', t('errors.core.arrangePlanStale'));
      }
      const floor = maxOrder(...steps.flatMap(step => Object.values(step.after.placements).map(rect => rect.zOrder)));
      const [version] = await this.#desk.reserveOrders(1, floor);
      this.#pending = { schemaVersion: 1, id, version, status: 'pending', steps, desk };
      // Even a failed acknowledgement fences dependent layout work until read-back proves its outcome.
      return this.#resume();
    });
  }
}
