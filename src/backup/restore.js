import { copy, requireValue, validRect } from '../core/contracts.js';
import { canonicalJson } from '../sources/json.js';
import { revisionRecord, RevisionGraph, validId } from '../sources/revisions.js';
import { projectRevisionsAsync, reconcileSourceLayout } from '../sources/projection.js';
import { LayoutStore, rescueRect } from '../layout/store.js';
import { regionShortcuts } from '../core/shortcuts.js';
import { groupLayersFromPapers } from '../layout/stages.js';
import { CURRENT_WORKSPACE_FORMAT, rebaseDraft, unneededDraft, unsavedByCard, Workspace } from '../core/workspace.js';
import { BackupDocument, createBackup } from './payload.js';
import { backupScheduler, checkCancelled } from './archive.js';
import { t } from '../i18n/index.js';

const planKey = Symbol('restore-plan'); const safetyKey = Symbol('saved-safety-backup');
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);

function allocator(state, data, uuid) {
  const used = new Set();
  const rememberDraft = draft => { [draft.id, draft.cardId, draft.groupId, draft.baseRevision].forEach(id => { if (id) used.add(id); }); };
  for (const record of [...state.revisions, ...data.records]) {
    [record.entityId, record.revisionId, record.value.groupId, record.value.redirectGroupId, ...record.parents]
      .forEach(id => { if (id) used.add(id); });
  }
  [...Object.values(state.drafts), ...data.drafts].forEach(rememberDraft);
  Object.keys(state.restoreReceipts || {}).forEach(id => used.add(id));
  return () => {
    const id = uuid(); requireValue(validId(id) && !used.has(id), 'restore-id-collision', t('errors.backup.restoreIdCollision'));
    used.add(id); return id;
  };
}

function remapDraft(draft, ids) {
  const result = copy(draft);
  result.id = ids.draft(result.id); result.cardId = ids.card(result.cardId); result.groupId = ids.group(result.groupId);
  if (result.cardId !== draft.cardId) delete result.purged;
  if (result.baseRevision !== null) result.baseRevision = ids.revision(result.baseRevision);
  // Unsaved changes no longer record what they were continued from (ADR-061).
  delete result.recoveredFrom;
  return result;
}

export function remapLayout(layout, ids) {
  const result = copy(layout);
  const grid = value => { value.slots = value.slots.map(id => id === null ? null : ids.group(id)); };
  const geometry = value => Object.fromEntries(Object.entries(value).map(([id, rect]) => [ids.card(id), rect]));
  grid(result.grid); result.placements = geometry(result.placements);
  if (result.myGroupId !== null) result.myGroupId = ids.group(result.myGroupId);
  if (result.mainGroupId !== undefined) result.mainGroupId = ids.group(result.mainGroupId);
  if (result.groupLayers) result.groupLayers = Object.fromEntries(Object.entries(result.groupLayers).map(([id, layer]) => [ids.group(id), layer]));
  if (result.groupColors) result.groupColors = Object.fromEntries(Object.entries(result.groupColors).map(([id, index]) => [ids.group(id), index]));
  if (result.groupOpacity) result.groupOpacity = Object.fromEntries(Object.entries(result.groupOpacity).map(([id, value]) => [ids.group(id), value]));
  for (const key of Object.keys(result.shortcuts)) if (!result.shortcuts[key].startsWith('@')) result.shortcuts[key] = ids.group(result.shortcuts[key]);
  for (const undo of result.history) {
    undo.before = geometry(undo.before);
    if (undo.gridBefore) grid(undo.gridBefore); if (undo.gridAfter) grid(undo.gridAfter);
    if (undo.transfer) {
      const item = undo.transfer; item.cardId = ids.card(item.cardId);
      item.fromGroupId = ids.group(item.fromGroupId); item.toGroupId = ids.group(item.toGroupId);
      item.previousRevision = ids.revision(item.previousRevision); item.expectedRevision = ids.revision(item.expectedRevision);
    }
  }
  return result;
}

async function importData(data, fresh, checkpoint, selected = null) {
  const maps = { card: new Map(), group: new Map(), revision: new Map(), draft: new Map() };
  const ids = Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, id => {
    if (selected && !selected[kind].has(id)) return id;
    if (!map.has(id)) map.set(id, fresh()); return map.get(id);
  }]));
  const records = [];
  for (const original of data.records) {
    const value = copy(original.value); value.id = ids[original.kind](value.id); value.revision = ids.revision(value.revision);
    if (original.kind === 'card') value.groupId = ids.group(value.groupId);
    else if (value.redirectGroupId) value.redirectGroupId = ids.group(value.redirectGroupId);
    records.push(revisionRecord(original.kind, value, original.parents.map(ids.revision))); await checkpoint();
  }
  const local = {
    cards: data.local.cards.map(item => ({ id: ids.card(item.id), revision: ids.revision(item.revision) })),
    groups: data.local.groups.map(item => ({ id: ids.group(item.id), revision: ids.revision(item.revision) })),
    membershipRebases: Object.fromEntries(Object.entries(data.local.membershipRebases).map(([old, edge]) =>
      [ids.revision(old), { cardId: ids.card(edge.cardId), revision: ids.revision(edge.revision) }])),
    transferIntents: data.local.transferIntents.map(item => ({ kind: 'transfer', cardId: ids.card(item.cardId),
      groupId: ids.group(item.groupId), expectedRevision: ids.revision(item.expectedRevision) })),
  };
  const result = { records, local, drafts: data.drafts.map(draft => remapDraft(draft, ids)), layout: remapLayout(data.layout, ids) };
  return { data: result, mappings: Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, Object.fromEntries(map)])) };
}

/** A host-confirmed saved backup of one exact committed profile revision. */
export class SafetyBackupReceipt {
  #binding;
  constructor(key, binding) { requireValue(key === safetyKey, 'invalid-safety-backup', t('errors.backup.safetyBackupRequired')); this.#binding = copy(binding); }
  get binding() { return copy(this.#binding); }
}

export async function saveSafetyBackup({ workspace, storage, save, ...options }) {
  requireValue(typeof save === 'function', 'missing-backup-host', t('errors.backup.saveHostRequired'));
  const state = workspace.state;
  const backup = await createBackup({ ...options, workspace, snapshot: state, storage }); checkCancelled(options.signal);
  await backup.verify?.();
  const result = await save({ bytes: backup.bytes, manifest: backup.manifest, encrypted: backup.encrypted, signal: options.signal });
  requireValue(result?.saved === true && typeof result.receipt === 'string' && result.receipt.length > 0 && result.receipt.length <= 4096,
    'backup-not-saved', t('errors.backup.safetyBackupNotSaved'));
  // A trusted adapter completes its irreversible save/readback phase despite a late cancellation.
  return new SafetyBackupReceipt(safetyKey, { profileId: state.profileId, revision: state.revision,
    backupId: backup.manifest.backupId, receipt: result.receipt });
}

/** Opaque immutable plan. Getters expose copies; only a verified BackupDocument can produce a plan. */
export class RestorePlan {
  #state; #document; #preview; #receipt; #verify;
  constructor(key, state, document, preview, receipt, verify = async () => {}) {
    requireValue(key === planKey, 'invalid-restore-plan', t('errors.backup.restorePlanRequired'));
    this.#state = state; this.#document = document; this.#preview = preview; this.#receipt = receipt; this.#verify = verify;
  }
  get preview() { return copy(this.#preview); }
  get receipt() { return copy(this.#receipt); }
  get attachments() { return this.#document.attachmentIds.map(id => ({ id, bytes: this.#document.attachment(id) })); }
  get history() { return copy(this.#state.revisions); }
  async verify() { await this.#verify(); }
  existing(state) {
    requireValue(state.profileId === this.#preview.profileId, 'restore-profile', t('errors.backup.restoreAccountChanged'));
    const found = state.restoreReceipts?.[this.#receipt.jobId];
    if (found) requireValue(equal(found, this.#receipt), 'restore-job-collision', t('errors.backup.restoreJobCollision'));
    return found ? copy(found) : null;
  }
  materialize(state, safety) {
    this.existing(state);
    requireValue(state.revision === this.#preview.revision, 'stale-restore-plan', t('errors.common.previewStale'));
    if (this.#preview.mode === 'replace') {
      const binding = safety instanceof SafetyBackupReceipt ? safety.binding : null;
      requireValue(binding?.profileId === state.profileId && binding.revision === state.revision,
        'missing-safety-backup', t('errors.backup.safetyBackupMissing'));
    }
    return copy(this.#state);
  }
}

/** Replaces only an offline workspace, using the same verified portable document and commit boundary. */
export async function prepareLocalRestore({ workspace, document, ...options }) {
  const current = workspace.state;
  requireValue(!current.profileId.startsWith('google:'), 'restore-profile', t('errors.backup.localNotesRequired'));
  requireValue(document instanceof BackupDocument, 'invalid-backup-data', t('errors.backup.backupNotVerified'));
  requireValue(options.repeat || !Object.values(current.restoreReceipts || {}).some(item => item.fingerprint === document.fingerprint),
    'already-restored', t('errors.backup.alreadyRestored'));
  const empty = await Workspace.create({ profileId: current.profileId, deviceId: current.layout.deviceId,
    area: options.workAreas?.[0], bootstrapGroup: false, persist: async () => {}, current: workspace.currentFormat });
  const restore = await prepareRestore({ ...options, workspace: empty, document, mode: workspace.currentFormat ? 'import' : 'merge', layout: 'backup' });
  const next = restore.materialize(empty.state);
  next.revision = current.revision;
  next.layout.revision = current.layout.revision + 1;
  const receipt = { ...restore.receipt, mode: 'local-replace', baseRevision: current.revision, committedRevision: current.revision + 1 };
  next.restoreReceipts = { [receipt.jobId]: receipt };
  const preview = { ...restore.preview, mode: 'local-replace', revision: current.revision, requiresSafetyBackup: false,
    removed: { cards: current.cards.length, groups: current.groups.length, drafts: Object.keys(current.drafts).length,
      revisions: current.revisions.length } };
  return new RestorePlan(planKey, next, document, preview, receipt);
}

export async function prepareRestore({ workspace, document, mode = 'import', layout = 'preserve', workAreas,
  repeat = false, uuid = () => crypto.randomUUID(), signal }) {
  requireValue(document instanceof BackupDocument, 'invalid-backup-data', t('errors.backup.backupNotVerified'));
  requireValue(['import', 'merge', 'replace'].includes(mode) && ['preserve', 'backup'].includes(layout),
    'invalid-restore-mode', t('errors.backup.restoreModeInvalid'));
  requireValue(Array.isArray(workAreas) && workAreas.length > 0 && workAreas.every(validRect), 'invalid-area', t('errors.backup.displayAreaRequired'));
  workAreas = copy(workAreas); checkCancelled(signal);
  const state = workspace.state; const original = document.data; const checkpoint = backupScheduler(signal);
  const current = state.format === CURRENT_WORKSPACE_FORMAT;
  requireValue(!current || document.manifest.coverage?.workspaceFormat === CURRENT_WORKSPACE_FORMAT,
    'unsupported-backup-schema', t('errors.backup.legacyFormat'));
  const graphOptions = { allowMissingParents: current };
  const guarded = [...new Set([...original.local.cards.map(card => card.id), ...state.cards.map(card => card.id)])];
  const purged = current && mode !== 'import' ? await workspace.restorationBarriers(guarded) : [];
  const verify = async () => {
    checkCancelled(signal);
    if (current && mode !== 'import') requireValue(equal(purged, await workspace.restorationBarriers(guarded)),
      'stale-restore-plan', t('errors.common.previewStale'));
  };
  const prior = Object.values(state.restoreReceipts || {}).find(item => item.fingerprint === document.fingerprint);
  requireValue(!prior || repeat, 'already-restored', t('errors.backup.alreadyRestored'), { receipt: prior });
  const fresh = allocator(state, original, uuid); const jobId = fresh();
  const affected = new Set(purged), selected = { card: affected, group: new Set(), revision: new Set(), draft: new Set() };
  for (const record of original.records) if (record.kind === 'card' && affected.has(record.entityId))
    for (const id of [record.revisionId, ...record.parents]) selected.revision.add(id);
  for (const draft of original.drafts) if (affected.has(draft.cardId)) {
    selected.draft.add(draft.id); if (draft.baseRevision) selected.revision.add(draft.baseRevision);
  }
  const imported = mode === 'import' || purged.length ? await importData(original, fresh, checkpoint, mode === 'import' ? null : selected) : { data: original, mappings: {} };
  const data = imported.data; const next = copy(state); const additions = [];
  const known = new Map(state.revisions.map(record => [record.revisionId, record]));
  const append = record => { additions.push(record); known.set(record.revisionId, record); };
  for (const record of data.records) {
    const previous = known.get(record.revisionId);
    requireValue(!previous || equal(previous, record), 'revision-collision', t('errors.backup.revisionCollision'));
    if (!previous) append(record); await checkpoint();
  }
  let graph = await RevisionGraph.create([...state.revisions, ...additions], checkpoint, graphOptions);
  const backupGraph = await RevisionGraph.create(data.records, checkpoint, graphOptions); const restoredHeads = new Map();
  const preferences = copy(data.local); let extraCards = 0; let retiredGroups = 0; let recoveryGroup = null;
  if (mode === 'replace') {
    const backupSnapshot = await projectRevisionsAsync(backupGraph, { ...data.local, conflicts: data.local.transferIntents }, checkpoint);
    let recipient = backupSnapshot.groups.find(group => !group.deleted)?.id;
    if (!recipient) {
      recoveryGroup = { id: fresh(), revision: fresh(), name: t('backup.restore.recoveryGroupName'), deleted: false }; recipient = recoveryGroup.id;
      append(revisionRecord('group', recoveryGroup)); preferences.groups.push({ id: recipient, revision: recoveryGroup.revision });
    }
    const restoreHeads = (kind, entityId, heads, patch = {}) => {
      const parents = [...new Set([...graph.heads(kind, entityId), ...heads].map(record => record.revisionId))];
      requireValue(parents.length <= 1024, 'restore-head-limit', t('errors.backup.headLimit'));
      for (const head of heads) {
        const value = { ...copy(head.value), ...patch, revision: fresh() };
        append(revisionRecord(kind, value, parents)); restoredHeads.set(head.revisionId, value.revision);
      }
    };
    for (const { kind, entityId, heads } of backupGraph.iterateEntities()) { restoreHeads(kind, entityId, heads); await checkpoint(); }
    const backupCards = new Set(data.local.cards.map(item => item.id)); const backupGroups = new Set(data.local.groups.map(item => item.id));
    for (const card of state.cards) if (!backupCards.has(card.id)) {
      restoreHeads('card', card.id, graph.heads('card', card.id), { deleted: true,
        ...current && !card.deleted ? { trashedAt: new Date().toISOString(), trashEpisode: fresh() } : {} }); extraCards++; await checkpoint();
    }
    for (const group of state.groups) if (!backupGroups.has(group.id)) {
      restoreHeads('group', group.id, graph.heads('group', group.id), { deleted: true, redirectGroupId: recipient }); retiredGroups++; await checkpoint();
    }
    for (const values of [preferences.cards, preferences.groups]) for (const value of values) value.revision = restoredHeads.get(value.revision) || value.revision;
    graph = await RevisionGraph.create([...state.revisions, ...additions], checkpoint, graphOptions);
  }
  next.revisions.push(...additions);
  for (const record of additions) next.outbox.push({ operationId: record.revisionId, kind: record.kind,
    entityId: record.entityId, parents: copy(record.parents), value: copy(record.value) });
  const prefer = (current, incoming) => {
    const ids = new Set((mode === 'replace' ? incoming : current).map(item => item.id));
    return mode === 'replace' ? [...incoming, ...current.filter(item => !ids.has(item.id))] : [...current, ...incoming.filter(item => !ids.has(item.id))];
  };
  const intents = new Map([...state.conflicts, ...data.local.transferIntents].map(item => [canonicalJson(item), item]));
  Object.assign(next, await projectRevisionsAsync(graph, { groups: prefer(state.groups, preferences.groups),
    cards: prefer(state.cards, preferences.cards), conflicts: [...intents.values()] }, checkpoint));
  next.membershipRebases ||= {}; const ambiguousRebases = [];
  const rebases = copy(data.local.membershipRebases);
  if (mode === 'replace') for (const [before, after] of restoredHeads) {
    const record = graph.get(before); const changed = graph.get(after);
    if (record.kind === 'card' && equal({ ...record.value, revision: after }, changed.value)) rebases[before] = { cardId: record.entityId, revision: after };
  }
  for (const [before, edge] of Object.entries(rebases)) {
    if (next.membershipRebases[before] && !equal(next.membershipRebases[before], edge)) {
      ambiguousRebases.push(before); delete next.membershipRebases[before];
    } else next.membershipRebases[before] = edge;
  }
  // A note keeps one set of unsaved changes (ADR-061). This device's own stay; a backup's set is added only where the
  // note has none worth keeping, holds something itself, and is not a never-saved note's text for a note saved since.
  // Stored sets holding nothing for that note go, and an added set whose ID another note's set uses takes a new ID.
  const ids = { draft: id => id, card: id => id, group: id => id, revision: id => restoredHeads.get(id) || id };
  const kept = unsavedByCard(next); const savedCards = new Set(next.cards.map(card => card.id)); const draftMap = {};
  let addedDrafts = 0;
  for (const draft of data.drafts) {
    const restored = rebaseDraft(next, remapDraft(draft, ids));
    if (!kept.has(restored.cardId) && !(restored.baseRevision === null && savedCards.has(restored.cardId)) && !unneededDraft(next, restored)) {
      for (const [id, other] of Object.entries(next.drafts)) if (other.cardId === restored.cardId) delete next.drafts[id];
      if (Object.hasOwn(next.drafts, restored.id)) restored.id = fresh();
      next.drafts[restored.id] = restored; kept.set(restored.cardId, restored); draftMap[draft.id] = restored.id; addedDrafts++;
    }
    await checkpoint();
  }
  const restoredLayout = remapLayout(data.layout, ids); const existingCards = new Set(state.cards.map(card => card.id));
  if (layout === 'backup') {
    if (mode === 'import') {
      for (const [id, rect] of Object.entries(restoredLayout.placements)) if (!existingCards.has(id)) next.layout.placements[id] = rescueRect(rect, workAreas);
      next.layout.history.push(...restoredLayout.history);
      next.layout.groupLayers = { ...restoredLayout.groupLayers, ...next.layout.groupLayers };
      // An opacity cannot clash, so imported groups keep the backup's while this device's own stay.
      next.layout.groupOpacity = { ...restoredLayout.groupOpacity, ...next.layout.groupOpacity };
      // Imported groups take free colours instead of the backup's, which could clash with this device's own.
    } else {
      next.layout = { ...restoredLayout, deviceId: state.layout.deviceId, revision: state.layout.revision,
        placements: { ...state.layout.placements, ...restoredLayout.placements } };
      for (const id of Object.keys(restoredLayout.placements)) next.layout.placements[id] = rescueRect(next.layout.placements[id], workAreas);
    }
  }
  next.layout = reconcileSourceLayout(next.layout, next);
  const temporaryLayout = new LayoutStore(next.layout, async value => { next.layout = value; });
  const placement = await temporaryLayout.placeNew(next, workAreas, undefined, checkpoint); next.layout.revision = state.layout.revision + 1;
  // An older backup's group-bound keys move to the regions those groups now hold, and its per-paper layers become group layers.
  next.layout.shortcuts = regionShortcuts(next.layout.shortcuts, next.layout.grid.slots);
  next.layout = groupLayersFromPapers(next.layout, next.cards);
  const receipt = { jobId, fingerprint: document.fingerprint, mode, layout, profileId: state.profileId,
    baseRevision: state.revision, committedRevision: state.revision + 1, mappings: { ...imported.mappings, restoredDrafts: draftMap },
    addedRevisions: additions.length, addedDrafts, extraCards, retiredGroups, ambiguousRebases };
  next.restoreReceipts ||= {}; next.restoreReceipts[jobId] = receipt;
  const preview = { jobId, profileId: state.profileId, revision: state.revision, mode, layout, fingerprint: document.fingerprint,
    backup: document.manifest, addedRevisions: additions.length, addedDrafts, extraCards, retiredGroups,
    recoveryGroup: recoveryGroup?.name || null, ambiguousRebases: ambiguousRebases.length,
    deferredPlacements: placement.deferred.length,
    result: { cards: next.cards.length, groups: next.groups.length, conflicts: next.conflicts.length, pendingRevisions: graph.pending.length },
    requiresSafetyBackup: mode === 'replace' };
  if (current) preview.recoveredAsNew = Object.keys(imported.mappings.card ?? {}).filter(id => affected.has(id)).length;
  await checkpoint(); checkCancelled(signal);
  return new RestorePlan(planKey, next, document, preview, receipt, verify);
}
