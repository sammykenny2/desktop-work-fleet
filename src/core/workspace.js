import { activeGroups, copy, FleetError, groupKey, membershipKey, requireValue, safeKey, validateNewGroup } from './contracts.js';
import { createLayout, LayoutStore, recordTransferLayout, retireGroupLayout } from '../layout/store.js';
import { planGroupMerge, resolveGroupId, validateGroupMerge } from './groups.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { revisionRecord, RevisionGraph, validateRevision } from '../sources/revisions.js';
import { projectRevisions, reconcileSourceLayout } from '../sources/projection.js';
import { regionShortcuts } from './shortcuts.js';
import { groupLayerOrder, groupLayersFromPapers } from '../layout/stages.js';
import { sha256, validDigest, validateFile } from '../sources/files.js';
import { schemas, requireSchemaVersion } from './schema.js';
import { initialGroupRecord, resetFileIds } from '../sources/initial-group.js';
import { encodeSourceRevision } from '../sources/source-revisions.js';
import { initializationComplete, initializationId, validateInitialization } from '../sources/workspace-initialization.js';
import { t } from '../i18n/index.js';

function contentValue(content) {
  requireValue(content && typeof content.text === 'string' && typeof content.format === 'string',
    'invalid-content', t('errors.core.contentInvalid'));
  // Preserve extension data and attachments; adapters must not reduce an unknown format to text.
  canonicalJson(content);
  return copy(content);
}

// Only the plain editor fields count; any extension data such as a title or capture metadata keeps the draft.
function blankContent(content) {
  return Boolean(content) && Object.keys(content).every(key => ['format', 'text', 'attachments'].includes(key))
    && !content.text.trim() && !content.attachments?.length;
}

// A draft has nothing to keep when it is blank or still an exact copy of its card's current revision.
function unneededDraft(state, draft) {
  if (!draft) return false;
  if (blankContent(draft.content)) return true;
  const card = draft.baseRevision ? state.cards.find(card => card.id === draft.cardId) : null;
  const plain = content => canonicalJson({ ...content, attachments: content.attachments || [] });
  return Boolean(card) && card.revision === draft.baseRevision && card.groupId === draft.groupId
    && plain(card.content) === plain(draft.content);
}

function loadRevisions(state) {
  const records = state.revisions || state.outbox.map(entry => revisionRecord(entry.kind, entry.value, entry.parents));
  const graph = new RevisionGraph(records);
  for (const [kind, values] of [['group', state.groups], ['card', state.cards]]) {
    for (const value of values) {
      requireValue(graph.get(value.revision)?.entityId === value.id && graph.get(value.revision)?.kind === kind
        && graph.isComplete(value.revision), 'incomplete-local-history', t('errors.core.localHistoryIncomplete'));
    }
  }
  return graph;
}

// Groups this device takes in for the first time, each on the layer chosen for new groups; none when no layer is chosen.
const arrivalLayers = (groups, layer) => groupLayerOrder.includes(layer) ? Object.fromEntries(groups.map(group => [group.id, layer])) : {};

function draftBaseline(draft) {
  if (!draft) return null;
  const value = copy(draft); delete value.recoveredFrom;
  return canonicalJson(value);
}

function rebaseMembership(state, draft) {
  if (state.groups.some(group => group.id === draft.groupId && group.deleted && group.redirectGroupId)) {
    try { draft.groupId = resolveGroupId(state, draft.groupId); }
    catch (error) { if (!['group-cycle', 'missing-group'].includes(error.code)) throw error; }
  }
  const seen = new Set();
  while (state.membershipRebases?.[draft.baseRevision]?.cardId === draft.cardId) {
    requireValue(!seen.has(draft.baseRevision), 'revision-cycle', t('errors.core.draftRevisionCycle'));
    seen.add(draft.baseRevision);
    draft.baseRevision = state.membershipRebases[draft.baseRevision].revision;
  }
  return draft;
}

function rebaseDraft(state, draft) {
  rebaseMembership(state, draft);
  for (const origin of draft.recoveredFrom || []) origin.baseline = draftBaseline(rebaseMembership(state, JSON.parse(origin.baseline)));
  return draft;
}

/** Account-scoped local journal. The persistence boundary includes content, outbox, drafts and layout. */
export class Workspace {
  #state;
  #persist;
  #uuid;
  #tail = Promise.resolve();
  #layout;
  #graph;
  #now;
  #runtimeId = crypto.randomUUID();
  #arrivalLayer = () => null;

  static async create({ profileId, deviceId, area, persist, bootstrapGroup = true, arrivalLayer = () => null,
    uuid = () => crypto.randomUUID(), now = Date.now }) {
    const groups = bootstrapGroup ? [{ id: uuid(), name: t('app.groups.defaultName'), revision: uuid(), deleted: false }] : [];
    const state = { schemaVersion: schemas.workspace, profileId, revision: 0, groups, cards: [],
      drafts: {}, membershipRebases: {}, outbox: groups.map(group => ({ operationId: group.revision, kind: 'group', entityId: group.id,
        parents: [], value: copy(group) })), revisions: groups.map(group => revisionRecord('group', group)),
      conflicts: [], sync: { sourceId: null, sessionId: null, cursor: null }, layout: createLayout(deviceId, groups, area) };
    state.layout.groupLayers = arrivalLayers(groups, arrivalLayer());
    await persist(copy(state), null);
    const workspace = new Workspace(state, persist, uuid, now);
    workspace.setArrivalLayer(arrivalLayer);
    return workspace;
  }

  constructor(state, persist, uuid = () => crypto.randomUUID(), now = Date.now) {
    requireSchemaVersion(state, 'workspace');
    this.#state = copy(state); this.#persist = persist; this.#uuid = uuid; this.#now = now;
    this.#graph = loadRevisions(this.#state);
    this.#state.revisions = this.#graph.records;
    Object.assign(this.#state, projectRevisions(this.#graph, this.#state));
    this.#state.sync ||= { sourceId: null, sessionId: null, cursor: null };
    // Group-bound keys and per-paper layers from older layouts are converted here and saved with the next layout change.
    this.#state.layout = groupLayersFromPapers(this.#state.layout, this.#state.cards);
    this.#state.layout.shortcuts = regionShortcuts(this.#state.layout.shortcuts, this.#state.layout.grid.slots);
    this.#layout = new LayoutStore(this.#state.layout, (layout, revision, validation) => this.#commit(draft => {
      requireValue(draft.layout.revision === revision, 'stale-layout', t('errors.core.layoutChangedByOther'));
      if (validation?.membership) requireValue(validation.membership === membershipKey(draft, draft.layout),
        'stale-plan', t('errors.common.previewStale'));
      if (validation?.groups) requireValue(validation.groups === groupKey(draft),
        'stale-groups', t('errors.core.groupsChanged'));
      draft.layout = copy(layout);
    }));
  }

  get snapshot() { return { groups: copy(this.#state.groups), cards: copy(this.#state.cards), writable: true,
    conflicts: copy(this.#state.conflicts) }; }
  get state() { return copy(this.#state); }
  get layout() { return this.#layout; }
  get syncState() { return copy(this.#state.sync); }
  get pendingOperations() { return copy(this.#state.outbox); }
  /** Picks the layer a group new to this device, made here or first received from a source, starts on; null keeps the desktop layer. */
  setArrivalLayer(choose) { this.#arrivalLayer = choose; }
  assertSyncSession(session) { this.#session(this.#state, session); }
  uploadState(session, operation) { this.#session(this.#state, session); return copy(this.#state.sync.uploads?.[operation] || null); }

  #commit(change, persist = this.#persist, replaceGraph = false) {
    const operation = this.#tail.then(async () => {
      const draft = copy(this.#state);
      const result = change(draft);
      const additions = draft.revisions.slice(this.#state.revisions.length);
      const graph = replaceGraph ? new RevisionGraph(draft.revisions) : additions.length ? this.#graph.fork(additions) : this.#graph;
      if (replaceGraph || additions.length) Object.assign(draft, projectRevisions(graph, draft));
      draft.revision++;
      await persist(copy(draft), this.#state.revision);
      this.#state = draft; this.#graph = graph;
      return result;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  /** One restore transaction includes attachment bytes; the caller must supply an atomic persistence adapter. */
  async applyRestore(plan, { persist, safetyBackup, signal } = {}) {
    const { RestorePlan } = await import('../backup/restore.js');
    requireValue(plan instanceof RestorePlan && typeof persist === 'function', 'invalid-restore-plan', t('errors.core.restorePlanRequired'));
    const replaceGraph = plan.preview.mode === 'local-replace';
    const cancelled = () => requireValue(!signal?.aborted, 'backup-cancelled', t('errors.core.restoreCancelled'));
    cancelled();
    return this.#layout.integrateSource(() => {
      cancelled(); const existing = plan.existing(this.#state);
      if (existing) return { layout: this.#state.layout, value: existing };
      return this.#commit(state => {
        cancelled(); const next = plan.materialize(state, safetyBackup);
        if (replaceGraph) for (const key of Object.keys(state)) delete state[key];
        Object.assign(state, next);
        return { layout: state.layout, value: plan.receipt };
      }, (state, revision) => persist(state, revision, plan.attachments,
        { replaceAttachments: replaceGraph }), replaceGraph);
    });
  }

  // Shared with every device as the card's reading order (compareCards); later revisions carry it unchanged.
  #createdAt() { return new Date(this.#now()).toISOString(); }

  #card(state, id, revision) {
    const card = state.cards.find(card => card.id === id);
    requireValue(card && !card.deleted, 'missing-card', t('errors.common.noteMissing'));
    requireValue(card.revision === revision, 'conflict', t('errors.core.noteUpdatedElsewhere'),
      { cardId: id, expectedRevision: revision, actualRevision: card.revision });
    this.#resolved(state, 'card', id);
    return card;
  }

  #resolved(state, kind, id) {
    requireValue(!state.conflicts.some(item => item.kind === 'revision' && item.entityKind === kind && item.entityId === id),
      'conflict', t('errors.core.conflictUnresolved'));
  }

  #group(state, id) {
    requireValue(state.groups.some(group => group.id === id && !group.deleted), 'missing-group', t('errors.common.groupMissingOrPending'));
    this.#resolved(state, 'group', id);
  }

  #record(state, kind, value, parents) {
    const record = revisionRecord(kind, value, parents);
    requireValue(!state.revisions.some(item => item.revisionId === record.revisionId), 'revision-collision', t('errors.core.revisionIdDuplicate'));
    requireValue(parents.every(parent => state.revisions.some(item => item.revisionId === parent
      && item.kind === kind && item.entityId === value.id)), 'missing-parent', t('errors.core.parentMissing'));
    state.revisions.push(record);
    state.outbox.push({ operationId: value.revision, kind, entityId: value.id, parents, value: copy(value) });
  }

  revisionHeads(kind, entityId) { return this.#graph.heads(kind, entityId); }

  revisionHistory(kind, entityId) {
    const queue = this.#graph.heads(kind, entityId).map(item => item.revisionId);
    const seen = new Set(); const result = [];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]; if (seen.has(id)) continue; seen.add(id);
      const record = this.#graph.get(id); result.push(record); queue.push(...record.parents);
    }
    return result;
  }

  async clearTransferIntent(intent) {
    const key = canonicalJson(intent);
    return this.#commit(state => {
      const index = state.conflicts.findIndex(item => item.kind === 'transfer' && canonicalJson(item) === key);
      requireValue(index >= 0, 'missing-intent', t('errors.core.moveIntentHandled'));
      state.conflicts.splice(index, 1);
    });
  }

  async retryTransferIntent(intent, expectedRevision) {
    intent = copy(intent); const key = canonicalJson(intent);
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      requireValue(state.layout.revision === revision, 'stale-layout', t('errors.common.layoutChanged'));
      const index = state.conflicts.findIndex(item => item.kind === 'transfer' && canonicalJson(item) === key);
      requireValue(index >= 0, 'missing-intent', t('errors.core.moveIntentHandled'));
      const card = this.#card(state, intent.cardId, expectedRevision); this.#group(state, intent.groupId);
      if (card.groupId !== intent.groupId) {
        const nextRevision = this.#uuid();
        recordTransferLayout(layout, card.id, undefined, { cardId: card.id, fromGroupId: card.groupId,
          toGroupId: intent.groupId, previousRevision: card.revision, expectedRevision: nextRevision });
        card.groupId = intent.groupId; card.revision = nextRevision;
        this.#record(state, 'card', card, [expectedRevision]); layout.revision++;
      }
      state.conflicts.splice(index, 1); state.layout = copy(layout);
      return { layout: state.layout, value: copy(card) };
    }));
  }

  async beginSync(sourceId) {
    requireValue(typeof sourceId === 'string' && sourceId.length > 0, 'invalid-source', t('errors.core.sourceIdRequired'));
    return this.#commit(state => {
      requireValue(!state.sync.sourceId || state.sync.sourceId === sourceId, 'source-mismatch', t('errors.core.sourceMismatch'));
      state.sync.sourceId = sourceId; state.sync.sessionId = this.#uuid();
      return { profileId: state.profileId, sourceId, sessionId: state.sync.sessionId, runtimeId: this.#runtimeId };
    });
  }

  #session(state, session) {
    requireValue(session && session.runtimeId === this.#runtimeId && session.profileId === state.profileId && session.sourceId === state.sync.sourceId
      && session.sessionId && session.sessionId === state.sync.sessionId,
    'stale-session', t('errors.core.sessionStale'));
  }

  async endSync(session) {
    session = copy(session);
    return this.#commit(state => { this.#session(state, session); state.sync.sessionId = null; });
  }

  async completeSync(session, completedAt) {
    requireValue(typeof completedAt === 'string' && Number.isFinite(Date.parse(completedAt)) && new Date(completedAt).toISOString() === completedAt,
      'invalid-sync-time', t('errors.core.syncTimeInvalid'));
    session = copy(session);
    return this.#commit(state => {
      this.#session(state, session);
      if (state.outbox.length) return false;
      state.sync.lastSuccessfulSyncAt = completedAt;
      return true;
    });
  }

  #file(state, file) {
    state.sync.files ||= {};
    const previous = Object.hasOwn(state.sync.files, file.id) ? state.sync.files[file.id] : null;
    requireValue(!previous || canonicalJson(previous) === canonicalJson(file), 'file-changed', t('errors.core.syncFileChanged'));
    state.sync.files[file.id] = copy(file);
  }

  async reserveUpload(session, key, file) {
    session = copy(session); file = validateFile(file);
    if (file.kind === 'revision') {
      const record = this.#graph.get(key);
      requireValue(record, 'missing-revision', t('errors.core.pendingRevisionMissing'));
      const bytes = encodeSourceRevision(record, resetFileIds(this.#state.sync.files));
      requireValue(file.size === bytes.byteLength && file.sha256 === await sha256(bytes), 'upload-mismatch', t('errors.core.uploadRevisionMismatch'));
    } else requireValue(validDigest(key) && key === file.sha256, 'upload-mismatch', t('errors.core.attachmentAddress'));
    return this.#commit(state => {
      this.#session(state, session); state.sync.uploads ||= {};
      const operation = `${file.kind}:${key}`;
      const existing = state.sync.uploads[operation];
      if (existing) {
        requireValue(existing.file.kind === file.kind && existing.file.sha256 === file.sha256 && existing.file.size === file.size,
          'upload-mismatch', t('errors.core.retryMismatch'));
        return copy(existing);
      }
      if (file.kind === 'revision') requireValue(state.outbox.some(item => item.operationId === key), 'missing-outbox', t('errors.core.outboxMissing'));
      requireValue(!Object.values(state.sync.uploads).some(item => item.file.id === file.id) && !Object.hasOwn(state.sync.files || {}, file.id),
        'file-id-collision', t('errors.core.fileIdCollision'));
      const upload = { file, complete: false };
      state.sync.uploads[operation] = copy(upload); return copy(upload);
    });
  }

  async completeUpload(session, operation, fileId) {
    session = copy(session);
    return this.#commit(state => {
      this.#session(state, session);
      const upload = state.sync.uploads?.[operation];
      requireValue(safeKey(operation) && upload?.file?.id === fileId, 'upload-mismatch', t('errors.core.uploadResponseMismatch'));
      upload.complete = true; this.#file(state, upload.file);
      if (upload.file.kind === 'revision') state.outbox = state.outbox.filter(entry => `revision:${entry.operationId}` !== operation);
    });
  }

  async receiveRevisions(records, { session, expectedCursor, cursor, files = [], workspaceRecords = [], initializationExpected = false,
    stage = false, activatePlan = null, expectedInitialization = null, initializationScanned = false, removedFiles = [] }) {
    records = records.map(validateRevision); session = copy(session);
    files = files.map(validateFile);
    const controls = await Promise.all(workspaceRecords.map(async value => {
      const record = await validateInitialization(value, session.sourceId); return { record, id: await initializationId(record) };
    }));
    requireValue(cursor === null || (typeof cursor === 'string' && cursor.length <= 8192), 'invalid-cursor', t('errors.core.cursorInvalid'));
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      this.#session(state, session);
      requireValue(state.sync.cursor === expectedCursor, 'stale-cursor', t('errors.core.cursorStale'));
      requireValue(state.layout.revision === revision, 'stale-layout', t('errors.core.layoutChangedRetrySync'));
      const pendingReset = state.sync.initialization?.expected && !state.sync.initialization.activePlan && !state.cloudRestore
        && !Object.keys(state.sync.initialization.plans).length && !Object.keys(state.sync.initialization.receipts).length;
      requireValue(!removedFiles.length || pendingReset, 'source-file-missing', t('errors.core.syncFileRemoved'));
      const previousResets = canonicalJson(resetFileIds(state.sync.files));
      for (const id of removedFiles) delete state.sync.files[id];
      for (const file of files) this.#file(state, file);
      if (pendingReset && canonicalJson(resetFileIds(state.sync.files)) !== previousResets) {
        state.sync.initialization = { plans: {}, receipts: {}, incoming: {}, activePlan: null, expected: true };
      }
      if (controls.length || initializationExpected) {
        state.sync.initialization ||= { plans: {}, receipts: {}, incoming: {}, activePlan: null };
        if (initializationExpected) state.sync.initialization.expected = true;
        for (const { id, record } of controls) {
          if (record.phase === 'prepare') state.sync.initialization.plans[id] = record;
          else {
            if (!state.sync.initialization.receipts[record.planId]) state.sync.initialization.refreshNeeded = true;
            state.sync.initialization.receipts[record.planId] = record;
          }
        }
      }
      const initialization = state.sync.initialization;
      if (initializationScanned && initialization) initialization.refreshNeeded = false;
      if (activatePlan) {
        requireValue(initialization && canonicalJson(initialization) === expectedInitialization
          && initialization.plans[activatePlan] && initialization.receipts[activatePlan]
          && Object.keys(initialization.plans).length === 1, 'stale-initialization', t('errors.core.initializationChanged'));
        initialization.activePlan = activatePlan; initialization.incoming = {};
      } else if (stage && initialization && !initialization.activePlan) {
        const known = new Map([...state.revisions, ...Object.values(initialization.incoming)].map(record => [record.revisionId, record]));
        for (const record of records) {
          requireValue(!known.has(record.revisionId) || canonicalJson(known.get(record.revisionId)) === canonicalJson(record),
            'revision-collision', t('errors.common.revisionCollision'));
          initialization.incoming[record.revisionId] = record; known.set(record.revisionId, record);
        }
        records = [];
      }
      // Tombstones count as seen: a group this device already holds as retired is not new when it comes back.
      const seenGroups = new Set(state.groups.map(group => group.id));
      const graph = this.#graph.fork(records);
      const known = new Set(state.revisions.map(item => item.revisionId));
      for (const record of records) if (!known.has(record.revisionId)) {
        state.revisions.push(record); known.add(record.revisionId);
      }
      const result = { added: graph.size - this.#graph.size, pending: graph.pending, missing: graph.missing };
      Object.assign(state, projectRevisions(graph, state));
      const arrived = arrivalLayers(activeGroups(state).filter(group => !seenGroups.has(group.id)), this.#arrivalLayer());
      state.layout = reconcileSourceLayout(layout, state, arrived); state.sync.cursor = cursor;
      if (cursor !== null) state.sync.sourceResetIds = resetFileIds(state.sync.files);
      return { layout: state.layout, value: result };
    }));
  }

  async activateInitialization(session, planId) {
    this.#session(this.#state, session);
    const initialization = this.#state.sync.initialization;
    if (!initialization?.plans[planId] || !initialization.receipts[planId]) return false;
    const incoming = Object.values(initialization.incoming);
    if (!await initializationComplete(initialization.plans[planId], [...this.#state.revisions, ...incoming], this.#state.sync.files)) return false;
    await this.receiveRevisions(incoming, { session, expectedCursor: this.#state.sync.cursor, cursor: this.#state.sync.cursor,
      activatePlan: planId, expectedInitialization: canonicalJson(initialization) });
    return true;
  }

  async saveSourceReset(job) {
    job = copy(job);
    return this.#commit(state => {
      requireValue(typeof job.sourceId === 'string' && (!state.sync.sourceId || state.sync.sourceId === job.sourceId),
        'source-mismatch', t('errors.core.resetJobMismatch'));
      state.sourceReset = job;
    });
  }

  /** Explicitly adopt one observed branch, optionally editing it; old revisions remain in history. */
  async resolveRevisions({ kind, entityId, heads, selectedRevision, patch = {}, fromHistory = false }) {
    heads = copy(heads); patch = copy(patch);
    requireValue(['card', 'group'].includes(kind), 'invalid-kind', t('errors.core.kindUnknown'));
    const allowed = kind === 'card' ? ['content', 'groupId', 'deleted', 'archived', 'completed'] : ['name', 'deleted', 'redirectGroupId'];
    requireValue(Object.keys(patch).every(key => allowed.includes(key)), 'invalid-command', t('errors.core.resolutionForbidden'));
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      requireValue(state.layout.revision === revision, 'stale-layout', t('errors.common.layoutChanged'));
      const current = this.#graph.heads(kind, entityId);
      requireValue(Array.isArray(heads) && new Set(heads).size === heads.length
        && JSON.stringify([...heads].sort()) === JSON.stringify(current.map(item => item.revisionId).sort()),
      'stale-resolution', t('errors.core.resolutionStale'));
      const selected = fromHistory ? this.#graph.get(selectedRevision) : current.find(item => item.revisionId === selectedRevision);
      requireValue(selected && selected.kind === kind && selected.entityId === entityId && this.#graph.isComplete(selected.revisionId),
        'missing-revision', t('errors.core.chosenRevisionMissing'));
      const value = { ...copy(selected.value), ...patch, revision: this.#uuid() };
      if (kind === 'card') {
        value.groupId = resolveGroupId(state, value.groupId); this.#group(state, value.groupId);
      } else if (!value.deleted) {
        delete value.redirectGroupId;
        if (!state.groups.some(group => group.id === value.id && !group.deleted)) validateNewGroup(state);
      } else {
        value.redirectGroupId = resolveGroupId(state, value.redirectGroupId);
        requireValue(value.redirectGroupId !== value.id, 'group-cycle', t('errors.core.groupRedirectSelf'));
      }
      this.#record(state, kind, value, heads);
      const graph = this.#graph.fork([state.revisions.at(-1)]);
      Object.assign(state, projectRevisions(graph, state));
      state.layout = reconcileSourceLayout(layout, state);
      return { layout: state.layout, value: copy(value) };
    }));
  }

  // A group made on this device starts on the layer chosen for new groups, recorded in the transaction that adds it.
  #addGroup(change) {
    return this.#layout.integrateSource((layout, layoutRevision) => this.#commit(state => {
      requireValue(state.layout.revision === layoutRevision, 'stale-layout', t('errors.common.layoutChanged'));
      const group = change(state);
      const arrived = group ? arrivalLayers([group], this.#arrivalLayer()) : {};
      if (Object.keys(arrived).length) state.layout = { ...layout, revision: layoutRevision + 1, groupLayers: { ...arrived, ...layout.groupLayers } };
      return { layout: state.layout, value: group };
    }));
  }

  async createGroup(name) {
    requireValue(typeof name === 'string' && name.trim(), 'invalid-name', t('errors.core.groupNameRequired'));
    return this.#addGroup(state => {
      validateNewGroup(state);
      const group = { id: this.#uuid(), revision: this.#uuid(), name: name.trim(), deleted: false };
      state.groups.push(group); this.#record(state, 'group', group, []);
      return copy(group);
    });
  }

  /** After a complete pull, every device derives the same initial root for this account and reset generation. */
  async ensureInitialGroup(session, planId = null) {
    session = copy(session); this.#session(this.#state, session);
    if (!planId && (this.#state.revisions.length || this.#state.groups.length)) return null;
    const resets = canonicalJson(resetFileIds(this.#state.sync.files));
    const record = await initialGroupRecord(session.sourceId, resetFileIds(this.#state.sync.files));
    return this.#addGroup(state => {
      this.#session(state, session);
      requireValue(state.sync.cursor !== null && canonicalJson(resetFileIds(state.sync.files)) === resets,
        'initial-sync-required', t('errors.common.initialSyncRequired'));
      if (planId) {
        const plan = state.sync.initialization?.plans[planId];
        requireValue(plan?.mode === 'starter' && plan.revisions[0].id === record.revisionId
          && canonicalJson(plan.sourceResetIds) === resets, 'stale-initialization', t('errors.core.initializationPlanChanged'));
        if (state.revisions.some(item => item.revisionId === record.revisionId)) return null;
      } else if (state.revisions.length || state.groups.length) return null;
      const group = record.value;
      state.groups.push(group); this.#record(state, 'group', group, []);
      return copy(group);
    });
  }

  async renameGroup(id, name, expectedRevision) {
    requireValue(typeof name === 'string' && name.trim(), 'invalid-name', t('errors.core.groupNameRequired'));
    return this.#commit(state => {
      this.#group(state, id);
      const group = state.groups.find(group => group.id === id);
      requireValue(group.revision === expectedRevision, 'conflict', t('errors.core.groupUpdated'));
      // An unchanged name is not an edit; a revision would sync and fork the group with any other device's edit.
      if (group.name === name.trim()) return copy(group);
      group.name = name.trim(); group.revision = this.#uuid();
      this.#record(state, 'group', group, [expectedRevision]);
      return copy(group);
    });
  }

  previewGroupMerge(sourceId, targetId) { return planGroupMerge(this.#state, sourceId, targetId); }

  async mergeGroup(plan) {
    plan = copy(plan);
    validateGroupMerge(this.#state, plan);
    const affected = this.#state.cards.filter(card => card.groupId === plan.sourceId).map(card => card.id);
    return this.#layout.integrateSource((layout, layoutRevision) => this.#commit(state => {
      validateGroupMerge(state, plan);
      this.#group(state, plan.sourceId); this.#group(state, plan.targetId);
      requireValue(state.layout.revision === layoutRevision, 'stale-layout', t('errors.common.layoutChanged'));
      state.membershipRebases ||= {};
      for (const card of state.cards.filter(card => card.groupId === plan.sourceId)) {
        this.#resolved(state, 'card', card.id);
        const previous = card.revision;
        card.groupId = plan.targetId; card.revision = this.#uuid();
        state.membershipRebases[previous] = { cardId: card.id, revision: card.revision };
        this.#record(state, 'card', card, [previous]);
      }
      const source = state.groups.find(group => group.id === plan.sourceId);
      const previous = source.revision;
      source.deleted = true; source.redirectGroupId = plan.targetId; source.revision = this.#uuid();
      this.#record(state, 'group', source, [previous]);
      for (const draft of Object.values(state.drafts)) rebaseDraft(state, draft);
      const result = retireGroupLayout(layout, plan.sourceId, plan.targetId, affected);
      state.layout = reconcileSourceLayout(layout, state);
      state.layout.revision = layoutRevision + 1;
      return { layout: state.layout, value: result };
    }));
  }

  async createCard(content, groupId = activeGroups(this.#state)[0]?.id) {
    const value = contentValue(content);
    return this.#commit(state => {
      groupId = resolveGroupId(state, groupId);
      this.#group(state, groupId);
      const card = { id: this.#uuid(), revision: this.#uuid(), groupId, content: value,
        deleted: false, archived: false, completed: false, createdAt: this.#createdAt() };
      state.cards.push(card); this.#record(state, 'card', card, []);
      return copy(card);
    });
  }

  async updateCard(cardId, patch, expectedRevision) {
    patch = copy(patch);
    requireValue(Object.keys(patch).every(key => ['content', 'archived', 'completed', 'deleted'].includes(key)),
      'invalid-command', t('errors.core.noteUpdateForbidden'));
    if ('content' in patch) contentValue(patch.content);
    for (const key of ['archived', 'completed', 'deleted']) {
      requireValue(!(key in patch) || typeof patch[key] === 'boolean', 'invalid-command', t('errors.core.noteFlagInvalid'));
    }
    return this.#commit(state => {
      const card = this.#card(state, cardId, expectedRevision);
      Object.assign(card, copy(patch), { revision: this.#uuid() });
      this.#record(state, 'card', card, [expectedRevision]);
      return copy(card);
    });
  }

  blankDraft(groupId, card = null) {
    this.#group(this.#state, card?.groupId || groupId);
    return { id: this.#uuid(), cardId: card?.id || this.#uuid(), groupId: card?.groupId || groupId,
      baseRevision: card?.revision ?? null,
      content: copy(card?.content || { format: 'markdown', text: '', attachments: [] }) };
  }

  recoverDraft(draftId) {
    const original = this.#state.drafts[draftId];
    requireValue(original, 'missing-draft', t('errors.core.draftMissing'));
    return { ...copy(original), id: this.#uuid(), recoveredFrom: [
      ...(original.recoveredFrom || []), { id: original.id, baseline: draftBaseline(original) },
    ] };
  }

  async commitDraft(draftId, { asCopy = false } = {}) {
    return this.#commit(state => {
      const draft = state.drafts[draftId];
      requireValue(draft, 'missing-draft', t('errors.core.savedDraftMissing'));
      this.#group(state, draft.groupId);
      let card;
      if (draft.baseRevision && !asCopy) {
        card = this.#card(state, draft.cardId, draft.baseRevision);
        card.content = copy(draft.content); card.revision = this.#uuid();
        this.#record(state, 'card', card, [draft.baseRevision]);
      } else {
        const id = asCopy ? this.#uuid() : draft.cardId;
        requireValue(!state.cards.some(existing => existing.id === id), 'duplicate-card', t('errors.core.noteDuplicate'));
        card = { id, revision: this.#uuid(), groupId: draft.groupId, content: copy(draft.content),
          deleted: false, archived: false, completed: false, createdAt: this.#createdAt() };
        state.cards.push(card); this.#record(state, 'card', card, []);
      }
      for (const origin of draft.recoveredFrom || []) {
        if (origin.id !== draftId && draftBaseline(state.drafts[origin.id]) === canonicalJson(parseJson(origin.baseline))) {
          delete state.drafts[origin.id];
        }
      }
      delete state.drafts[draftId];
      return copy(card);
    });
  }

  async restoreCard(cardId, expectedRevision) {
    return this.#commit(state => {
      const card = state.cards.find(card => card.id === cardId);
      requireValue(card && card.deleted && card.revision === expectedRevision, 'conflict', t('errors.core.deletedNoteChanged'));
      this.#resolved(state, 'card', cardId);
      this.#group(state, card.groupId);
      card.deleted = false; card.revision = this.#uuid();
      this.#record(state, 'card', card, [expectedRevision]);
      return copy(card);
    });
  }

  async transferCard({ cardId, groupId, expectedRevision, position, expectedLayoutRevision }) {
    try {
      const current = this.#card(this.#state, cardId, expectedRevision);
      this.#group(this.#state, groupId);
      if (current.groupId === groupId) {
        if (position) await this.#layout.move(cardId, position, expectedLayoutRevision);
        return;
      }
      const revision = this.#uuid();
      const transfer = { cardId, fromGroupId: current.groupId, toGroupId: groupId,
        previousRevision: expectedRevision, expectedRevision: revision };
      await this.#layout.transfer(cardId, position, expectedLayoutRevision, transfer, (layout, layoutRevision) => this.#commit(state => {
        requireValue(state.layout.revision === layoutRevision, 'stale-layout', t('errors.core.layoutChangedPlain'));
        const card = this.#card(state, cardId, expectedRevision);
        this.#group(state, groupId);
        card.groupId = groupId; card.revision = revision;
        this.#record(state, 'card', card, [expectedRevision]);
        state.layout = copy(layout);
      }));
    } catch (error) {
      if (error instanceof FleetError && error.code === 'conflict') {
        await this.#commit(state => state.conflicts.push({ kind: 'transfer', cardId, groupId, expectedRevision }));
      }
      throw error;
    }
  }

  async undo(workAreas) {
    const undoRevision = this.#uuid();
    return this.#layout.undo(() => this.snapshot, workAreas, (layout, layoutRevision, result) => this.#commit(state => {
      requireValue(state.layout.revision === layoutRevision, 'stale-layout', t('errors.core.layoutChangedPlain'));
      if (result.transfer) {
        const { cardId, fromGroupId, expectedRevision } = result.transfer;
        const card = this.#card(state, cardId, expectedRevision);
        this.#group(state, fromGroupId);
        card.groupId = fromGroupId; card.revision = undoRevision;
        this.#record(state, 'card', card, [expectedRevision]);
      }
      state.layout = copy(layout);
    }), undoRevision);
  }

  async saveDraft(draft) {
    draft = copy(draft);
    requireValue(safeKey(draft.id) && safeKey(draft.cardId), 'invalid-draft', t('errors.core.draftIdInvalid'));
    contentValue(draft.content);
    return this.#commit(state => { state.drafts[draft.id] = rebaseDraft(state, copy(draft)); });
  }

  /** Drops a draft with nothing to keep, and such drafts it was recovered from that have not changed since. */
  async discardUnneededDraft(draftId) {
    await this.#tail;
    if (!unneededDraft(this.#state, this.#state.drafts[draftId])) return false;
    return this.#commit(state => {
      const draft = state.drafts[draftId];
      if (!unneededDraft(state, draft)) return false;
      for (const origin of draft.recoveredFrom || []) {
        const original = state.drafts[origin.id];
        if (origin.id !== draftId && unneededDraft(state, original)
          && draftBaseline(original) === canonicalJson(parseJson(origin.baseline))) delete state.drafts[origin.id];
      }
      delete state.drafts[draftId];
      return true;
    });
  }
}
