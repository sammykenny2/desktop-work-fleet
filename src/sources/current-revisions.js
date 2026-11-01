import { compareId, copy, requireValue } from '../core/contracts.js';
import { canonicalJson } from './json.js';
import { validateRevision } from './revisions.js';
import { t } from '../i18n/index.js';

const identity = record => `${record.kind}:${record.entityId}`;

/** Current values only. Missing historical parents are context, not missing current inputs (SPEC-010 D02). */
export class CurrentRevisions {
  #records = new Map();
  #entities = new Map();
  constructor(batch = []) { this.ingest(batch); }
  get size() { return this.#records.size; }
  get records() { return [...this.#records.values()].sort((a, b) => compareId(a.revisionId, b.revisionId)).map(copy); }
  get missing() { return []; }
  get pending() { return []; }
  get(id) { return copy(this.#records.get(id) ?? null); }
  isComplete(id) { return this.#records.has(id); }
  heads(kind, id) { return (this.#entities.get(`${kind}:${id}`) ?? []).map(copy); }
  *iterateEntities() {
    for (const key of [...this.#entities.keys()].sort(compareId)) {
      const heads = this.#entities.get(key);
      yield { kind: heads[0].kind, entityId: heads[0].entityId, heads: heads.map(copy) };
    }
  }
  entities() { return [...this.iterateEntities()]; }
  fork(batch = []) {
    const next = new CurrentRevisions(); next.#records = this.#records; next.#entities = this.#entities;
    next.ingest(batch); return next;
  }
  ingest(batch) {
    requireValue(Array.isArray(batch), 'invalid-revision-record', t('errors.sources.revisionInvalid'));
    const records = new Map(this.#records); let added = 0;
    for (const input of batch) {
      const record = validateRevision(input), old = records.get(record.revisionId);
      if (old) requireValue(canonicalJson(old) === canonicalJson(record), 'revision-collision', t('errors.common.revisionCollision'));
      else { records.set(record.revisionId, record); added++; }
    }
    const remaining = new Map(), children = new Map(), consumed = new Set();
    for (const record of records.values()) {
      let count = 0;
      for (const id of record.parents) {
        const parent = records.get(id); if (!parent) continue;
        requireValue(identity(parent) === identity(record), 'parent-identity', t('errors.sources.parentIdentity'));
        count++; consumed.add(id);
        if (!children.has(id)) children.set(id, []);
        children.get(id).push(record.revisionId);
      }
      remaining.set(record.revisionId, count);
    }
    const queue = [...remaining.keys()].filter(id => remaining.get(id) === 0);
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) {
      remaining.set(child, remaining.get(child) - 1); if (!remaining.get(child)) queue.push(child);
    }
    requireValue(queue.length === records.size, 'revision-cycle', t('errors.sources.revisionCycle'));
    const heads = new Map(), entities = new Map();
    for (const record of records.values()) if (!consumed.has(record.revisionId)) {
      heads.set(record.revisionId, record);
      const key = identity(record); if (!entities.has(key)) entities.set(key, []);
      entities.get(key).push(record);
    }
    for (const values of entities.values()) values.sort((a, b) => compareId(a.revisionId, b.revisionId));
    this.#records = heads; this.#entities = entities;
    return { added, pending: [], missing: [] };
  }
}
