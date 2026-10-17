import { compareId, copy, requireValue, safeKey } from '../core/contracts.js';
import { canonicalJson, parseJson } from './json.js';
import { schemas, requireSchemaVersion } from '../core/schema.js';
import { t } from '../i18n/index.js';

export const REVISION_FORMAT = 'work-fleet-revision';
const envelopeKeys = ['entityId', 'format', 'kind', 'parents', 'revisionId', 'schemaVersion', 'value'].sort();
export const validId = value => safeKey(value) && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const identity = record => JSON.stringify([record.kind, record.entityId]);
const invalid = condition => requireValue(condition, 'invalid-revision-record', t('errors.sources.revisionInvalid'));

/** Values retain unknown JSON extension fields. Unknown envelope versions never enter the graph. */
export function validateRevision(input) {
  const record = parseJson(canonicalJson(input));
  invalid(record && typeof record === 'object' && !Array.isArray(record));
  requireSchemaVersion(record, 'revision', { code: 'unsupported-revision-format' });
  requireValue(record.format === REVISION_FORMAT,
    'unsupported-revision-format', t('errors.sources.revisionFormatUnsupported'));
  invalid(JSON.stringify(Object.keys(record).sort()) === JSON.stringify(envelopeKeys));
  invalid(['card', 'group'].includes(record.kind) && validId(record.entityId) && validId(record.revisionId));
  invalid(Array.isArray(record.parents) && record.parents.length <= 1024
    && record.parents.every(parent => validId(parent) && parent !== record.revisionId)
    && new Set(record.parents).size === record.parents.length);
  record.parents.sort(compareId);
  const value = record.value;
  invalid(value && typeof value === 'object' && !Array.isArray(value)
    && value.id === record.entityId && value.revision === record.revisionId && typeof value.deleted === 'boolean');
  if (record.kind === 'group') {
    invalid(typeof value.name === 'string' && value.name.trim().length > 0);
    invalid(value.redirectGroupId === undefined || (value.deleted && validId(value.redirectGroupId) && value.redirectGroupId !== value.id));
    invalid(!value.deleted || validId(value.redirectGroupId));
  } else {
    invalid(validId(value.groupId) && typeof value.archived === 'boolean' && typeof value.completed === 'boolean');
    const content = value.content;
    invalid(content && typeof content === 'object' && !Array.isArray(content)
      && typeof content.text === 'string' && typeof content.format === 'string' && content.format.length > 0);
    invalid(content.title === undefined || typeof content.title === 'string');
    if (content.attachments !== undefined) {
      invalid(Array.isArray(content.attachments));
      for (const item of content.attachments) {
        invalid(item && validId(item.id) && typeof item.name === 'string'
          && (item.mediaType === undefined || typeof item.mediaType === 'string')
          && (item.size === undefined || (Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= 25 * 1024 * 1024)));
      }
    }
  }
  return record;
}

export function revisionRecord(kind, value, parents = []) {
  return validateRevision({ format: REVISION_FORMAT, schemaVersion: schemas.revision, kind,
    entityId: value.id, revisionId: value.revision, parents, value });
}

export const encodeRevision = record => new TextEncoder().encode(canonicalJson(validateRevision(record)));
export const decodeRevision = bytes => validateRevision(parseJson(bytes));

function* analysisSteps(records) {
  const remaining = new Map(); const children = new Map(); const missing = new Set();
  let work = 0;
  for (const [id, record] of records) {
    let known = 0;
    for (const parentId of record.parents) {
      const parent = records.get(parentId);
      if (parent) {
        requireValue(identity(parent) === identity(record), 'parent-identity', t('errors.sources.parentIdentity'));
        known++;
        if (!children.has(parentId)) children.set(parentId, []);
        children.get(parentId).push(id);
      } else missing.add(parentId);
      if (++work % 128 === 0) yield;
    }
    remaining.set(id, known);
    if (++work % 128 === 0) yield;
  }
  const queue = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  const complete = new Set();
  // A topological walk also rejects cycles through records whose other parents are still missing.
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]; const record = records.get(id);
    if (record.parents.every(parent => complete.has(parent))) complete.add(id);
    for (const child of children.get(id) || []) {
      const count = remaining.get(child) - 1; remaining.set(child, count);
      if (count === 0) queue.push(child);
      if (++work % 128 === 0) yield;
    }
    if (++work % 128 === 0) yield;
  }
  requireValue(queue.length === records.size, 'revision-cycle', t('errors.sources.revisionCycle'));
  const heads = new Map();
  for (const id of complete) {
    const key = identity(records.get(id));
    if (!heads.has(key)) heads.set(key, new Set());
    heads.get(key).add(id);
    if (++work % 128 === 0) yield;
  }
  for (const id of complete) {
    const record = records.get(id);
    for (const parent of record.parents) {
      heads.get(identity(record)).delete(parent);
      if (++work % 128 === 0) yield;
    }
    if (++work % 128 === 0) yield;
  }
  return { complete, heads, missing: [...missing].sort(compareId),
    pending: [...records.keys()].filter(id => !complete.has(id)).sort(compareId) };
}

function analyze(records) {
  const steps = analysisSteps(records); let result;
  do { result = steps.next(); } while (!result.done);
  return result.value;
}

/** Atomic in-memory graph; callers persist records and cursor in the same local transaction. */
export class RevisionGraph {
  #records = new Map();
  #canonical = new Map();
  #analysis = analyze(new Map());

  constructor(records = []) { this.ingest(records); }

  /** Isolated bulk reader: the same graph rules, with cancellable checkpoints before publication. */
  static async create(batch, checkpoint) {
    invalid(Array.isArray(batch)); batch = copy(batch); const graph = new RevisionGraph();
    for (const input of batch) {
      const record = validateRevision(input); const bytes = canonicalJson(record);
      if (graph.#records.has(record.revisionId)) {
        requireValue(graph.#canonical.get(record.revisionId) === bytes, 'revision-collision',
          t('errors.common.revisionCollision'));
      } else {
        graph.#records.set(record.revisionId, record); graph.#canonical.set(record.revisionId, bytes);
      }
      await checkpoint();
    }
    const steps = analysisSteps(graph.#records); let result;
    do { result = steps.next(); if (!result.done) await checkpoint(); } while (!result.done);
    graph.#analysis = result.value; await checkpoint(); return graph;
  }
  get size() { return this.#records.size; }
  get records() { return [...this.#records.values()].sort((a, b) => compareId(a.revisionId, b.revisionId)).map(copy); }
  get pending() { return copy(this.#analysis.pending); }
  get missing() { return copy(this.#analysis.missing); }
  get(id) { return copy(this.#records.get(id) ?? null); }
  isComplete(id) { return this.#analysis.complete.has(id); }

  /** Reuse already validated immutable records; failed candidate changes leave this graph untouched. */
  fork(batch = []) {
    const graph = new RevisionGraph();
    graph.#records = this.#records; graph.#canonical = this.#canonical; graph.#analysis = this.#analysis;
    graph.ingest(batch);
    return graph;
  }

  heads(kind, entityId) {
    return [...(this.#analysis.heads.get(JSON.stringify([kind, entityId])) || [])]
      .sort(compareId).map(id => this.get(id));
  }

  *iterateEntities() {
    for (const key of [...this.#analysis.heads.keys()].sort(compareId)) {
      const [kind, entityId] = JSON.parse(key);
      yield { kind, entityId, heads: this.heads(kind, entityId) };
    }
  }

  entities() { return [...this.iterateEntities()]; }

  ingest(batch) {
    invalid(Array.isArray(batch));
    const records = new Map(this.#records); const canonical = new Map(this.#canonical);
    let added = 0;
    for (const input of batch) {
      const record = validateRevision(input); const bytes = canonicalJson(record);
      if (records.has(record.revisionId)) {
        requireValue(canonical.get(record.revisionId) === bytes, 'revision-collision',
          t('errors.common.revisionCollision'));
      } else {
        records.set(record.revisionId, record); canonical.set(record.revisionId, bytes); added++;
      }
    }
    const analysis = analyze(records);
    this.#records = records; this.#canonical = canonical; this.#analysis = analysis;
    return { added, pending: this.pending, missing: this.missing };
  }
}
