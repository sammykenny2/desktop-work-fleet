import { copy, requireValue, validRect } from '../core/contracts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { revisionRecord, RevisionGraph, validId } from '../sources/revisions.js';
import { projectRevisionsAsync, reconcileSourceLayout } from '../sources/projection.js';
import { LayoutStore, rescueRect } from '../layout/store.js';
import { regionShortcuts } from '../core/shortcuts.js';
import { groupLayersFromPapers } from '../layout/stages.js';
import { Workspace } from '../core/workspace.js';
import { BackupDocument, createBackup } from './payload.js';
import { backupScheduler, checkCancelled } from './archive.js';

const planKey = Symbol('restore-plan'); const safetyKey = Symbol('saved-safety-backup');
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);

function allocator(state, data, uuid) {
  const used = new Set();
  const rememberDraft = draft => {
    [draft.id, draft.cardId, draft.groupId, draft.baseRevision].forEach(id => { if (id) used.add(id); });
    for (const origin of draft.recoveredFrom || []) { used.add(origin.id); rememberDraft(parseJson(origin.baseline)); }
  };
  for (const record of [...state.revisions, ...data.records]) {
    [record.entityId, record.revisionId, record.value.groupId, record.value.redirectGroupId, ...record.parents]
      .forEach(id => { if (id) used.add(id); });
  }
  [...Object.values(state.drafts), ...data.drafts].forEach(rememberDraft);
  Object.keys(state.restoreReceipts || {}).forEach(id => used.add(id));
  return () => {
    const id = uuid(); requireValue(validId(id) && !used.has(id), 'restore-id-collision', '新身分重複或無效，尚未還原。');
    used.add(id); return id;
  };
}

function remapDraft(draft, ids) {
  const result = copy(draft);
  result.id = ids.draft(result.id); result.cardId = ids.card(result.cardId); result.groupId = ids.group(result.groupId);
  if (result.baseRevision !== null) result.baseRevision = ids.revision(result.baseRevision);
  for (const origin of result.recoveredFrom || []) {
    origin.id = ids.draft(origin.id); origin.baseline = canonicalJson(remapDraft(parseJson(origin.baseline), ids));
  }
  return result;
}

function remapLayout(layout, ids) {
  const result = copy(layout);
  const grid = value => { value.slots = value.slots.map(id => id === null ? null : ids.group(id)); };
  const geometry = value => Object.fromEntries(Object.entries(value).map(([id, rect]) => [ids.card(id), rect]));
  grid(result.grid); result.placements = geometry(result.placements);
  if (result.myGroupId !== null) result.myGroupId = ids.group(result.myGroupId);
  if (result.groupLayers) result.groupLayers = Object.fromEntries(Object.entries(result.groupLayers).map(([id, layer]) => [ids.group(id), layer]));
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

async function importData(data, fresh, checkpoint) {
  const maps = { card: new Map(), group: new Map(), revision: new Map(), draft: new Map() };
  const ids = Object.fromEntries(Object.entries(maps).map(([kind, map]) => [kind, id => {
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
  constructor(key, binding) { requireValue(key === safetyKey, 'invalid-safety-backup', '需要已保存的還原前備份。'); this.#binding = copy(binding); }
  get binding() { return copy(this.#binding); }
}

export async function saveSafetyBackup({ workspace, storage, save, ...options }) {
  requireValue(typeof save === 'function', 'missing-backup-host', '需要確認檔案保存成功的介面。');
  const state = workspace.state;
  const backup = await createBackup({ ...options, workspace: { state }, storage }); checkCancelled(options.signal);
  const result = await save({ bytes: backup.bytes, manifest: backup.manifest, encrypted: backup.encrypted, signal: options.signal });
  requireValue(result?.saved === true && typeof result.receipt === 'string' && result.receipt.length > 0 && result.receipt.length <= 4096,
    'backup-not-saved', '尚未確認還原前備份已保存，不能取代資料。');
  // A trusted adapter completes its irreversible save/readback phase despite a late cancellation.
  return new SafetyBackupReceipt(safetyKey, { profileId: state.profileId, revision: state.revision,
    backupId: backup.manifest.backupId, receipt: result.receipt });
}

/** Opaque immutable plan. Getters expose copies; only a verified BackupDocument can produce a plan. */
export class RestorePlan {
  #state; #document; #preview; #receipt;
  constructor(key, state, document, preview, receipt) {
    requireValue(key === planKey, 'invalid-restore-plan', '需要有效的還原預覽。');
    this.#state = state; this.#document = document; this.#preview = preview; this.#receipt = receipt;
  }
  get preview() { return copy(this.#preview); }
  get receipt() { return copy(this.#receipt); }
  get attachments() { return this.#document.attachmentIds.map(id => ({ id, bytes: this.#document.attachment(id) })); }
  existing(state) {
    requireValue(state.profileId === this.#preview.profileId, 'restore-profile', '還原目標帳號已切換，請重新預覽。');
    const found = state.restoreReceipts?.[this.#receipt.jobId];
    if (found) requireValue(equal(found, this.#receipt), 'restore-job-collision', '還原工作身分包含不同內容。');
    return found ? copy(found) : null;
  }
  materialize(state, safety) {
    this.existing(state);
    requireValue(state.revision === this.#preview.revision, 'stale-restore-plan', '預覽後資料已變更，請重新預覽。');
    if (this.#preview.mode === 'replace') {
      const binding = safety instanceof SafetyBackupReceipt ? safety.binding : null;
      requireValue(binding?.profileId === state.profileId && binding.revision === state.revision,
        'missing-safety-backup', '請先成功保存目前這一版資料的還原前備份。');
    }
    return copy(this.#state);
  }
}

/** Replaces only an offline workspace, using the same verified portable document and commit boundary. */
export async function prepareLocalRestore({ workspace, document, ...options }) {
  const current = workspace.state;
  requireValue(!current.profileId.startsWith('google:'), 'restore-profile', '請先切換到本機便箋，再清空本機還原。');
  requireValue(document instanceof BackupDocument, 'invalid-backup-data', '請先驗證完整備份。');
  requireValue(options.repeat || !Object.values(current.restoreReceipts || {}).some(item => item.fingerprint === document.fingerprint),
    'already-restored', '這份備份已還原；只有明確選擇再還原一次才建立新工作。');
  const empty = await Workspace.create({ profileId: current.profileId, deviceId: current.layout.deviceId,
    area: options.workAreas?.[0], bootstrapGroup: false, persist: async () => {} });
  const restore = await prepareRestore({ ...options, workspace: empty, document, mode: 'merge', layout: 'backup' });
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
  requireValue(document instanceof BackupDocument, 'invalid-backup-data', '請先驗證完整備份。');
  requireValue(['import', 'merge', 'replace'].includes(mode) && ['preserve', 'backup'].includes(layout),
    'invalid-restore-mode', '請選擇有效還原模式與版面選項。');
  requireValue(Array.isArray(workAreas) && workAreas.length > 0 && workAreas.every(validRect), 'invalid-area', '需要可用的顯示區域。');
  workAreas = copy(workAreas); checkCancelled(signal);
  const state = workspace.state; const original = document.data; const checkpoint = backupScheduler(signal);
  const prior = Object.values(state.restoreReceipts || {}).find(item => item.fingerprint === document.fingerprint);
  requireValue(!prior || repeat, 'already-restored', '這份備份已還原；只有明確選擇再還原一次才建立新工作。', { receipt: prior });
  const fresh = allocator(state, original, uuid); const jobId = fresh();
  const imported = mode === 'import' ? await importData(original, fresh, checkpoint) : { data: original, mappings: {} };
  const data = imported.data; const next = copy(state); const additions = [];
  const known = new Map(state.revisions.map(record => [record.revisionId, record]));
  const append = record => { additions.push(record); known.set(record.revisionId, record); };
  for (const record of data.records) {
    const previous = known.get(record.revisionId);
    requireValue(!previous || equal(previous, record), 'revision-collision', '同一版本身分包含不同內容，沒有還原任何資料。');
    if (!previous) append(record); await checkpoint();
  }
  let graph = await RevisionGraph.create([...state.revisions, ...additions], checkpoint);
  const backupGraph = await RevisionGraph.create(data.records, checkpoint); const restoredHeads = new Map();
  const preferences = copy(data.local); let extraCards = 0; let retiredGroups = 0; let recoveryGroup = null;
  if (mode === 'replace') {
    const backupSnapshot = await projectRevisionsAsync(backupGraph, { ...data.local, conflicts: data.local.transferIntents }, checkpoint);
    let recipient = backupSnapshot.groups.find(group => !group.deleted)?.id;
    if (!recipient) {
      recoveryGroup = { id: fresh(), revision: fresh(), name: '還原後保留', deleted: false }; recipient = recoveryGroup.id;
      append(revisionRecord('group', recoveryGroup)); preferences.groups.push({ id: recipient, revision: recoveryGroup.revision });
    }
    const restoreHeads = (kind, entityId, heads, patch = {}) => {
      const parents = [...new Set([...graph.heads(kind, entityId), ...heads].map(record => record.revisionId))];
      requireValue(parents.length <= 1024, 'restore-head-limit', '並行版本超過單次取代上限，請先整理衝突。');
      for (const head of heads) {
        const value = { ...copy(head.value), ...patch, revision: fresh() };
        append(revisionRecord(kind, value, parents)); restoredHeads.set(head.revisionId, value.revision);
      }
    };
    for (const { kind, entityId, heads } of backupGraph.iterateEntities()) { restoreHeads(kind, entityId, heads); await checkpoint(); }
    const backupCards = new Set(data.local.cards.map(item => item.id)); const backupGroups = new Set(data.local.groups.map(item => item.id));
    for (const card of state.cards) if (!backupCards.has(card.id)) {
      restoreHeads('card', card.id, graph.heads('card', card.id), { deleted: true }); extraCards++; await checkpoint();
    }
    for (const group of state.groups) if (!backupGroups.has(group.id)) {
      restoreHeads('group', group.id, graph.heads('group', group.id), { deleted: true, redirectGroupId: recipient }); retiredGroups++; await checkpoint();
    }
    for (const values of [preferences.cards, preferences.groups]) for (const value of values) value.revision = restoredHeads.get(value.revision) || value.revision;
    graph = await RevisionGraph.create([...state.revisions, ...additions], checkpoint);
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
  const draftMap = new Map(data.drafts.map(draft => [draft.id, draft.id]));
  const dependents = new Map(); const draftById = new Map(data.drafts.map(draft => [draft.id, draft]));
  for (const draft of data.drafts) for (const origin of draft.recoveredFrom || []) {
    if (!dependents.has(origin.id)) dependents.set(origin.id, []); dependents.get(origin.id).push(draft.id);
  }
  const ids = { draft: id => draftMap.get(id) || id, card: id => id, group: id => id, revision: id => restoredHeads.get(id) || id };
  const queue = [...draftById.keys()];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (draftMap.get(id) === id && Object.hasOwn(next.drafts, id) && !equal(next.drafts[id], remapDraft(draftById.get(id), ids))) {
      draftMap.set(id, fresh()); queue.push(...(dependents.get(id) || []));
    }
    await checkpoint();
  }
  let addedDrafts = 0;
  for (const draft of data.drafts) {
    const restored = remapDraft(draft, ids);
    if (!Object.hasOwn(next.drafts, restored.id)) { next.drafts[restored.id] = restored; addedDrafts++; }
    await checkpoint();
  }
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
  const restoredLayout = remapLayout(data.layout, ids); const existingCards = new Set(state.cards.map(card => card.id));
  if (layout === 'backup') {
    if (mode === 'import') {
      for (const [id, rect] of Object.entries(restoredLayout.placements)) if (!existingCards.has(id)) next.layout.placements[id] = rescueRect(rect, workAreas);
      next.layout.history.push(...restoredLayout.history);
      next.layout.groupLayers = { ...restoredLayout.groupLayers, ...next.layout.groupLayers };
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
    baseRevision: state.revision, committedRevision: state.revision + 1, mappings: { ...imported.mappings, restoredDrafts: Object.fromEntries(draftMap) },
    addedRevisions: additions.length, addedDrafts, extraCards, retiredGroups, ambiguousRebases };
  next.restoreReceipts ||= {}; next.restoreReceipts[jobId] = receipt;
  const preview = { jobId, profileId: state.profileId, revision: state.revision, mode, layout, fingerprint: document.fingerprint,
    backup: document.manifest, addedRevisions: additions.length, addedDrafts, extraCards, retiredGroups,
    recoveryGroup: recoveryGroup?.name || null, ambiguousRebases: ambiguousRebases.length,
    deferredPlacements: placement.deferred.length,
    result: { cards: next.cards.length, groups: next.groups.length, conflicts: next.conflicts.length, pendingRevisions: graph.pending.length },
    requiresSafetyBackup: mode === 'replace' };
  await checkpoint(); checkCancelled(signal);
  return new RestorePlan(planKey, next, document, preview, receipt);
}
