import { requireValue, safeKey, gridRegions, validRect } from './contracts.js';
import { schemas, migrateSchema, requireSchemaVersion } from './schema.js';
import { regionShortcuts, validateShortcuts } from './shortcuts.js';
import { groupLayersFromPapers } from '../layout/stages.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { RevisionGraph, revisionRecord, validId } from '../sources/revisions.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const valid = condition => requireValue(condition, 'invalid-workspace', '本機工作空間格式無效；原資料仍保留。');
const workspaceLimits = Object.freeze({ bytes: 128 * 1024 * 1024, depth: 128, nodes: 64 * 1024 * 1024 });

function validateIndex(index) {
  valid(object(index) && [Object.prototype, null].includes(Object.getPrototypeOf(index)));
  for (const [key, value] of Object.entries(index)) { valid(safeKey(key)); canonicalJson(value, workspaceLimits); }
}

function validateGrid(grid, groups) {
  valid(object(grid) && Array.isArray(grid.slots));
  const ids = new Set(groups.map(group => group.id));
  valid(grid.slots.every(id => id === null || ids.has(id)));
  // Conflicts can retain >9 groups or retired groups; only the groups represented in this grid need fit.
  gridRegions(grid, groups.filter(group => grid.slots.includes(group.id)));
}

function validateLayout(layout, state) {
  requireSchemaVersion(layout, 'layout');
  valid(validId(layout.deviceId) && Number.isSafeInteger(layout.revision) && layout.revision >= 0
    && typeof layout.desktopVisible === 'boolean' && (layout.myGroupId === null || state.groups.some(group => group.id === layout.myGroupId))
    && object(layout.placements) && Array.isArray(layout.history));
  validateGrid(layout.grid, state.groups); validateShortcuts(layout.shortcuts, state.groups);
  const cards = new Set(state.cards.map(card => card.id)); const groups = new Set(state.groups.map(group => group.id));
  const geometry = rect => validRect(rect) && Number.isFinite(rect.order);
  for (const [id, rect] of Object.entries(layout.placements)) valid(cards.has(id) && geometry(rect) && typeof rect.visible === 'boolean');
  valid(object(layout.groupLayers) && Object.entries(layout.groupLayers).every(([id, layer]) => groups.has(id) && ['wallpaper', 'desktop', 'floating'].includes(layer)));
  for (const entry of layout.history) {
    valid(object(entry) && ['move', 'formation', 'transfer'].includes(entry.kind) && object(entry.before));
    for (const [id, rect] of Object.entries(entry.before)) valid(cards.has(id) && geometry(rect));
    if (entry.gridBefore) validateGrid(entry.gridBefore, state.groups);
    if (entry.gridAfter) validateGrid(entry.gridAfter, state.groups);
    if (entry.kind === 'transfer') valid(object(entry.transfer) && cards.has(entry.transfer.cardId)
      && groups.has(entry.transfer.fromGroupId) && groups.has(entry.transfer.toGroupId)
      && validId(entry.transfer.previousRevision) && validId(entry.transfer.expectedRevision));
  }
}

function validateDraft(draft, id, graph) {
  valid(object(draft) && draft.id === id && validId(id) && validId(draft.cardId)
    && (draft.groupId === undefined || validId(draft.groupId))
    && (draft.baseRevision === undefined || draft.baseRevision === null || validId(draft.baseRevision)));
  const base = graph.get(draft.baseRevision); valid(!base || base.kind === 'card' && base.entityId === draft.cardId);
  // The original saveDraft API allowed these fields to be absent. Validate content without inventing a persisted baseline.
  revisionRecord('card', { id: draft.cardId, revision: draft.baseRevision || 'draft-check', groupId: draft.groupId || 'draft-check-group',
    content: draft.content, deleted: false, archived: false, completed: false });
  if (draft.recoveredFrom !== undefined) {
    valid(Array.isArray(draft.recoveredFrom)); const ids = new Set([id]);
    for (const origin of draft.recoveredFrom) {
      valid(object(origin) && validId(origin.id) && !ids.has(origin.id) && typeof origin.baseline === 'string'); ids.add(origin.id);
      const baseline = parseJson(origin.baseline); valid(baseline.recoveredFrom === undefined); validateDraft(baseline, origin.id, graph);
    }
  }
}

export function workspaceGraph(state) {
  const graph = new RevisionGraph(state.revisions);
  for (const [kind, values] of [['group', state.groups], ['card', state.cards]]) {
    for (const value of values) requireValue(graph.get(value.revision)?.entityId === value.id
      && graph.get(value.revision)?.kind === kind && graph.isComplete(value.revision),
    'incomplete-local-history', '本機版本歷史不完整，資料保留，請先恢復來源。');
  }
  return graph;
}

function validate(state) {
  // The 8 MiB protocol limit applies to individual records, not the workspace's entire history.
  for (const [key, value] of Object.entries(state)) {
    valid(safeKey(key));
    if (['revisions', 'outbox', 'cards', 'groups'].includes(key) && Array.isArray(value)) {
      for (const record of value) canonicalJson(record);
    } else if (key === 'drafts' && value && typeof value === 'object') {
      for (const [id, draft] of Object.entries(value)) { requireValue(safeKey(id), 'invalid-workspace', '草稿身分無效。'); canonicalJson(draft); }
    } else if (['membershipRebases', 'restoreReceipts'].includes(key)) validateIndex(value);
    else if (key === 'sync' && object(value)) {
      for (const [field, item] of Object.entries(value)) {
        valid(safeKey(field));
        if (['files', 'uploads'].includes(field)) validateIndex(item); else canonicalJson(item, workspaceLimits);
      }
    } else if (key === 'layout' && object(value)) {
      for (const [field, item] of Object.entries(value)) {
        valid(safeKey(field));
        if (['placements', 'groupLayers'].includes(field)) validateIndex(item);
        else if (field === 'history' && Array.isArray(item)) { for (const entry of item) canonicalJson(entry, workspaceLimits); }
        else canonicalJson(item, workspaceLimits);
      }
    } else canonicalJson(value, workspaceLimits);
  }
  requireValue(safeKey(state.profileId) && Number.isSafeInteger(state.revision) && state.revision >= 0
    && Array.isArray(state.cards) && Array.isArray(state.groups) && Array.isArray(state.revisions)
    && Array.isArray(state.outbox) && Array.isArray(state.conflicts)
    && state.drafts && typeof state.drafts === 'object' && !Array.isArray(state.drafts)
    && state.sync && typeof state.sync === 'object' && !Array.isArray(state.sync)
    && state.membershipRebases && typeof state.membershipRebases === 'object' && !Array.isArray(state.membershipRebases),
  'invalid-workspace', '本機工作空間格式無效；原資料仍保留。');
  const graph = workspaceGraph(state);
  validateLayout(state.layout, state);
  for (const [id, draft] of Object.entries(state.drafts)) validateDraft(draft, id, graph);
  for (const operation of state.outbox) {
    valid(object(operation)); const record = revisionRecord(operation.kind, operation.value, operation.parents);
    valid(record.revisionId === operation.operationId && record.entityId === operation.entityId
      && canonicalJson(graph.get(record.revisionId)) === canonicalJson(record));
  }
  for (const key of ['sourceId', 'sessionId', 'cursor']) valid(state.sync[key] === null || typeof state.sync[key] === 'string');
  return graph;
}

export function migrateWorkspace(input) {
  let graph;
  const result = migrateSchema(input, { kind: 'workspace', current: schemas.workspace, steps: {
    1: state => {
      // Missing history can only be recovered from the complete persisted outbox, never from invented roots.
      state.revisions ??= state.outbox.map(entry => revisionRecord(entry.kind, entry.value, entry.parents));
      state.sync ??= { sourceId: null, sessionId: null, cursor: null };
      state.membershipRebases ??= {};
      // Validate the source shortcuts before conversion so malformed or unknown targets cannot be silently dropped.
      validateShortcuts(state.layout.shortcuts, state.groups);
      state.layout = groupLayersFromPapers(state.layout, state.cards);
      state.layout.shortcuts = regionShortcuts(state.layout.shortcuts, state.layout.grid.slots);
      return state;
    },
  }, validate: state => { graph = validate(state); } });
  return { ...result, graph };
}
