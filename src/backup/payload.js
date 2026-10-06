import { copy, requireValue, validRect } from '../core/contracts.js';
import { validateShortcuts } from '../core/shortcuts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { decodeRevision, encodeRevision, revisionRecord, RevisionGraph, validId } from '../sources/revisions.js';
import { projectRevisionsAsync, projectionConflictKinds } from '../sources/projection.js';
import { sha256, validDigest } from '../sources/files.js';
import { BACKUP_LIMITS, backupScheduler, checkCancelled, entryLimit, packZip, unpackZip } from './archive.js';
import { decryptBackup, encryptBackup } from './encryption.js';

const encoder = new TextEncoder();
const encode = value => encoder.encode(canonicalJson(value));
const fail = condition => requireValue(condition, 'invalid-backup-data', '備份資料格式、引用或數量不一致，尚未匯入。');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => fail(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value))
  && new Date(value).toISOString() === value;
const filename = (kind, index) => `${kind}/${String(index).padStart(8, '0')}.json`;

function validateDraft(draft, graph, references, baseline = false) {
  fail(object(draft) && validId(draft.id) && validId(draft.cardId) && validId(draft.groupId)
    && (draft.baseRevision === null || validId(draft.baseRevision)));
  const known = draft.baseRevision === null ? null : graph.get(draft.baseRevision);
  fail(!known || (known.kind === 'card' && known.entityId === draft.cardId));
  revisionRecord('card', { id: draft.cardId, revision: draft.baseRevision || 'backup-draft', groupId: draft.groupId,
    content: draft.content, deleted: false, archived: false, completed: false });
  references.push(...(draft.content.attachments || []));
  if (baseline) fail(draft.recoveredFrom === undefined);
  else if (draft.recoveredFrom !== undefined) {
    fail(Array.isArray(draft.recoveredFrom)); const seen = new Set([draft.id]);
    for (const origin of draft.recoveredFrom) {
      fail(object(origin) && validId(origin.id) && !seen.has(origin.id) && typeof origin.baseline === 'string'); seen.add(origin.id);
      const previous = parseJson(origin.baseline); fail(previous.id === origin.id);
      validateDraft(previous, graph, references, true);
    }
  }
}

function validateGrid(grid, groups) {
  fail(object(grid) && count(grid.rows) && grid.rows >= 1 && grid.rows <= 3 && count(grid.columns) && grid.columns >= 1
    && grid.columns <= 4 && grid.rows * grid.columns <= 9 && validRect(grid.area)
    && Array.isArray(grid.slots) && grid.slots.length === grid.rows * grid.columns);
  const filled = grid.slots.filter(id => id !== null);
  fail(new Set(filled).size === filled.length && filled.every(id => groups.has(id)));
}

function validateLayout(layout, snapshot, graph) {
  fail(object(layout) && layout.schemaVersion === 1 && validId(layout.deviceId) && count(layout.revision)
    && typeof layout.desktopVisible === 'boolean' && (layout.myGroupId === null || validId(layout.myGroupId))
    && object(layout.placements) && Array.isArray(layout.history));
  const groups = new Set(snapshot.groups.map(item => item.id)); const cards = new Set(snapshot.cards.map(item => item.id));
  validateGrid(layout.grid, groups);
  // Retired/cyclic targets remain recoverable preferences. Source reconciliation repairs them explicitly.
  fail(layout.myGroupId === null || groups.has(layout.myGroupId)); validateShortcuts(layout.shortcuts, snapshot.groups);
  const geometry = value => validRect(value) && Number.isFinite(value.order);
  const layers = ['desktop', 'wallpaper', 'floating'];
  for (const [id, rect] of Object.entries(layout.placements)) fail(cards.has(id) && geometry(rect)
    && typeof rect.visible === 'boolean' && (rect.readOnlySelect === undefined || typeof rect.readOnlySelect === 'boolean')
    && (rect.residentLayer === undefined || layers.includes(rect.residentLayer)));
  // Older backups kept the layer on each paper instead of in groupLayers.
  fail(layout.groupLayers === undefined || object(layout.groupLayers)
    && Object.entries(layout.groupLayers).every(([id, layer]) => groups.has(id) && layers.includes(layer)));
  for (const undo of layout.history) {
    fail(object(undo) && ['move', 'formation', 'transfer'].includes(undo.kind) && object(undo.before));
    for (const [id, rect] of Object.entries(undo.before)) fail(cards.has(id) && geometry(rect));
    if (undo.gridBefore) validateGrid(undo.gridBefore, groups);
    if (undo.gridAfter) validateGrid(undo.gridAfter, groups);
    if (undo.kind === 'transfer') {
      const transfer = undo.transfer;
      fail(object(transfer) && cards.has(transfer.cardId) && groups.has(transfer.fromGroupId) && groups.has(transfer.toGroupId)
        && [transfer.previousRevision, transfer.expectedRevision].every(id => {
          const record = graph.get(id); return record?.kind === 'card' && record.entityId === transfer.cardId;
        }));
    }
  }
}

async function validateData(data, checkpoint) {
  const { records, drafts, local, layout } = data;
  fail(Array.isArray(records) && Array.isArray(drafts) && new Set(records.map(item => item.revisionId)).size === records.length);
  const graph = await RevisionGraph.create(records, checkpoint); const references = [];
  exact(local, ['cards', 'groups', 'membershipRebases', 'transferIntents']);
  const selected = {};
  for (const [kind, values] of [['card', local.cards], ['group', local.groups]]) {
    fail(Array.isArray(values) && new Set(values.map(item => item.id)).size === values.length);
    selected[kind] = new Map();
    for (const item of values) {
      exact(item, ['id', 'revision']);
      fail(validId(item.id) && validId(item.revision)); selected[kind].set(item.id, item.revision); await checkpoint();
    }
  }
  for (const { kind, entityId, heads } of graph.iterateEntities()) {
    fail(heads.some(head => head.revisionId === selected[kind].get(entityId))); selected[kind].delete(entityId); await checkpoint();
  }
  fail(selected.card.size === 0 && selected.group.size === 0);
  fail(object(local.membershipRebases) && Array.isArray(local.transferIntents));
  for (const [oldRevision, edge] of Object.entries(local.membershipRebases)) {
    exact(edge, ['cardId', 'revision']);
    const before = graph.get(oldRevision); const after = graph.get(edge.revision);
    fail(before?.kind === 'card' && after?.kind === 'card' && before.entityId === edge.cardId && after.entityId === edge.cardId
      && after.parents.includes(oldRevision));
    const strip = value => { value = copy(value); delete value.groupId; delete value.revision; return canonicalJson(value); };
    fail(strip(before.value) === strip(after.value));
    await checkpoint();
  }
  for (const intent of local.transferIntents) {
    exact(intent, ['kind', 'cardId', 'groupId', 'expectedRevision']);
    fail(intent.kind === 'transfer' && validId(intent.cardId) && validId(intent.groupId) && validId(intent.expectedRevision));
    await checkpoint();
  }
  const snapshot = await projectRevisionsAsync(graph, { cards: local.cards, groups: local.groups, conflicts: local.transferIntents }, checkpoint);
  validateLayout(layout, snapshot, graph);
  for (const record of records) { if (record.kind === 'card') references.push(...(record.value.content.attachments || [])); await checkpoint(); }
  fail(new Set(drafts.map(item => item.id)).size === drafts.length);
  for (const draft of drafts) { validateDraft(draft, graph, references); await checkpoint(); }
  const attachments = new Map();
  for (const reference of references) {
    fail(validDigest(reference.id));
    const sizes = attachments.get(reference.id) || new Set();
    if (reference.size !== undefined) sizes.add(reference.size);
    fail(sizes.size <= 1); attachments.set(reference.id, sizes);
    await checkpoint();
  }
  return { graph, snapshot, attachments, counts: { cards: snapshot.cards.length, groups: snapshot.groups.length,
    revisions: records.length, drafts: drafts.length, attachments: attachments.size, conflicts: snapshot.conflicts.length,
    pendingRevisions: graph.pending.length } };
}

const documentKey = Symbol('validated-backup');
export class BackupDocument {
  #manifest;
  #data;
  #attachments;
  #fingerprint;
  constructor(key, manifest, data, attachments, fingerprint) {
    fail(key === documentKey); this.#manifest = manifest; this.#data = data; this.#attachments = attachments; this.#fingerprint = fingerprint;
  }
  get manifest() { return copy(this.#manifest); }
  get data() { return copy(this.#data); }
  get fingerprint() { return this.#fingerprint; }
  get attachmentIds() { return [...this.#attachments.keys()]; }
  attachment(id) { return this.#attachments.get(id)?.slice() ?? null; }
}

function validateManifest(manifest) {
  exact(manifest, ['format', 'schemaVersion', 'backupId', 'createdAt', 'appVersion', 'scope', 'pendingOperations', 'lastSuccessfulSyncAt', 'counts', 'files']);
  fail(manifest.format === 'work-fleet-backup' && manifest.schemaVersion === 1 && validId(manifest.backupId)
    && date(manifest.createdAt) && typeof manifest.appVersion === 'string' && manifest.appVersion.length > 0 && manifest.appVersion.length <= 64
    && manifest.scope === 'known-local-data' && count(manifest.pendingOperations)
    && (manifest.lastSuccessfulSyncAt === null || date(manifest.lastSuccessfulSyncAt)) && Array.isArray(manifest.files));
  exact(manifest.counts, ['cards', 'groups', 'revisions', 'drafts', 'attachments', 'conflicts', 'pendingRevisions']);
  fail(Object.values(manifest.counts).every(count));
  const names = new Set();
  for (const file of manifest.files) {
    exact(file, ['name', 'size', 'sha256']);
    fail(typeof file.name === 'string' && !['manifest.json', 'encryption.json', 'payload.bin'].includes(file.name) && !names.has(file.name)
      && count(file.size) && file.size <= entryLimit(file.name) && validDigest(file.sha256)); names.add(file.name);
  }
}

export async function openBackup(bytes, { password, ...options } = {}) {
  let files = await unpackZip(bytes, options);
  if (files.has('encryption.json')) files = await decryptBackup(files, password, options);
  fail(files.has('manifest.json') && files.has('local.json') && files.has('layout.json'));
  const manifest = parseJson(files.get('manifest.json')); validateManifest(manifest);
  fail(files.size === manifest.files.length + 1); const checkpoint = backupScheduler(options.signal);
  for (const entry of manifest.files) {
    const content = files.get(entry.name); fail(content?.length === entry.size && await sha256(content) === entry.sha256);
    await checkpoint();
  }
  const data = { records: [], drafts: [], local: parseJson(files.get('local.json')), layout: parseJson(files.get('layout.json')) };
  const attachments = new Map();
  for (const [name, content] of files) {
    if (name.startsWith('revisions/')) data.records.push(decodeRevision(content));
    else if (name.startsWith('drafts/')) data.drafts.push(parseJson(content));
    else if (name.startsWith('attachments/')) {
      const id = name.slice(12, -4); fail(await sha256(content) === id); attachments.set(id, content);
    }
    await checkpoint();
  }
  const validated = await validateData(data, checkpoint); fail(canonicalJson(validated.counts) === canonicalJson(manifest.counts));
  fail(attachments.size === validated.attachments.size);
  for (const [id, sizes] of validated.attachments) fail(attachments.has(id) && (!sizes.size || sizes.has(attachments.get(id).length)));
  const fingerprint = await sha256(encode(manifest)); checkCancelled(options.signal);
  return new BackupDocument(documentKey, manifest, data, attachments, fingerprint);
}

/** Capture one committed Workspace state, then resolve immutable attachment hashes from that profile only. */
export async function createBackup({ workspace, storage, appVersion = '0.1.0', password,
  now = () => new Date(), uuid = () => crypto.randomUUID(), signal, progress = () => {} }) {
  checkCancelled(signal); const state = workspace.state; const profileId = state.profileId;
  requireValue(state.conflicts.every(item => item.kind === 'transfer' || projectionConflictKinds.has(item.kind)),
    'unsupported-backup-data', '本機包含尚未支援的衝突資料，不能省略後宣稱備份完成。');
  const data = { records: state.revisions, drafts: Object.values(state.drafts), layout: state.layout,
    local: { cards: state.cards.map(({ id, revision }) => ({ id, revision })), groups: state.groups.map(({ id, revision }) => ({ id, revision })),
      membershipRebases: state.membershipRebases || {}, transferIntents: state.conflicts.filter(item => item.kind === 'transfer') } };
  const checkpoint = backupScheduler(signal);
  const validated = await validateData(data, checkpoint); const files = new Map(); let expanded = 0;
  const add = (name, bytes) => {
    expanded += bytes.length;
    requireValue(files.size + 1 + (name === 'manifest.json' ? 0 : 1) <= BACKUP_LIMITS.entries && expanded <= BACKUP_LIMITS.expandedBytes,
      'backup-limit', '資料超過備份容量或項目上限，尚未省略任何內容。'); files.set(name, bytes);
  };
  for (let i = 0; i < data.records.length; i++) { add(filename('revisions', i), encodeRevision(data.records[i])); await checkpoint(); }
  for (let i = 0; i < data.drafts.length; i++) { add(filename('drafts', i), encode(data.drafts[i])); await checkpoint(); }
  add('local.json', encode(data.local)); add('layout.json', encode(data.layout));
  let completed = 0;
  for (const [id, sizes] of validated.attachments) {
    const blob = await storage.getAttachment(profileId, id); checkCancelled(signal);
    requireValue(blob instanceof Blob && blob.size <= BACKUP_LIMITS.attachmentBytes && (!sizes.size || sizes.has(blob.size)),
      'incomplete-backup', '尚缺附件或大小不符，不能宣稱已完成備份；原資料保留。');
    requireValue(expanded + blob.size <= BACKUP_LIMITS.expandedBytes, 'backup-limit', '備份附件超過總容量，尚未截斷。');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    requireValue(await sha256(bytes) === id, 'incomplete-backup', '本機附件校驗失敗，尚未輸出備份。');
    add(`attachments/${id}.bin`, bytes); progress({ phase: 'attachments', completed: ++completed, total: validated.attachments.size });
    await checkpoint();
  }
  const entries = [];
  for (const [name, bytes] of files) { entries.push({ name, size: bytes.length, sha256: await sha256(bytes) }); await checkpoint(); }
  const manifest = { format: 'work-fleet-backup', schemaVersion: 1, backupId: uuid(), createdAt: now().toISOString(),
    appVersion, scope: 'known-local-data', pendingOperations: state.outbox.length,
    lastSuccessfulSyncAt: state.sync?.lastSuccessfulSyncAt || null, counts: validated.counts, files: entries };
  validateManifest(manifest); add('manifest.json', encode(manifest));
  const options = { signal, progress }; let result = await packZip(files, options);
  // A successful export has passed the same parser, hashes and domain validation as an import.
  await openBackup(result, options);
  if (password !== undefined) result = await encryptBackup(result, password, options);
  checkCancelled(signal); return { bytes: result, manifest: copy(manifest), encrypted: password !== undefined };
}
