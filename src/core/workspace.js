import { activeGroups, copy, FleetError, groupKey, membershipKey, requireValue, safeKey, validateNewGroup } from './contracts.js';
import { createLayout, LayoutStore, recordTransferLayout, retireGroupLayout } from '../layout/store.js';
import { planGroupMerge, resolveGroupId, validateGroupMerge } from './groups.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { revisionRecord, RevisionGraph, validateRevision } from '../sources/revisions.js';
import { projectRevisions, reconcileSourceLayout } from '../sources/projection.js';
import { regionShortcuts } from './shortcuts.js';
import { groupLayersFromPapers } from '../layout/stages.js';
import { sha256, validDigest, validateFile } from '../sources/files.js';
import { schemas, requireSchemaVersion } from './schema.js';
import { initialGroupRecord, resetFileIds } from '../sources/initial-group.js';
import { encodeSourceRevision } from '../sources/source-revisions.js';

function contentValue(content) {
  requireValue(content && typeof content.text === 'string' && typeof content.format === 'string',
    'invalid-content', '便箋需要文字及格式。');
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
        && graph.isComplete(value.revision), 'incomplete-local-history', '本機版本歷史不完整，資料保留，請先恢復來源。');
    }
  }
  return graph;
}

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
    requireValue(!seen.has(draft.baseRevision), 'revision-cycle', '群組版本關係無效，草稿尚未提交。');
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

  static async create({ profileId, deviceId, area, persist, bootstrapGroup = true, uuid = () => crypto.randomUUID(), now = Date.now }) {
    const groups = bootstrapGroup ? [{ id: uuid(), name: '我的便箋', revision: uuid(), deleted: false }] : [];
    const state = { schemaVersion: schemas.workspace, profileId, revision: 0, groups, cards: [],
      drafts: {}, membershipRebases: {}, outbox: groups.map(group => ({ operationId: group.revision, kind: 'group', entityId: group.id,
        parents: [], value: copy(group) })), revisions: groups.map(group => revisionRecord('group', group)),
      conflicts: [], sync: { sourceId: null, sessionId: null, cursor: null }, layout: createLayout(deviceId, groups, area) };
    await persist(copy(state), null);
    return new Workspace(state, persist, uuid, now);
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
      requireValue(draft.layout.revision === revision, 'stale-layout', '版面已由另一個寫入者變更。');
      if (validation?.membership) requireValue(validation.membership === membershipKey(draft, draft.layout),
        'stale-plan', '預覽後資料已變更，請重新預覽。');
      if (validation?.groups) requireValue(validation.groups === groupKey(draft),
        'stale-groups', '群組已變更，請重新開啟設定或排列。');
      draft.layout = copy(layout);
    }));
  }

  get snapshot() { return { groups: copy(this.#state.groups), cards: copy(this.#state.cards), writable: true,
    conflicts: copy(this.#state.conflicts) }; }
  get state() { return copy(this.#state); }
  get layout() { return this.#layout; }
  get syncState() { return copy(this.#state.sync); }
  get pendingOperations() { return copy(this.#state.outbox); }
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
    requireValue(plan instanceof RestorePlan && typeof persist === 'function', 'invalid-restore-plan', '需要有效預覽及原子還原儲存介面。');
    const replaceGraph = plan.preview.mode === 'local-replace';
    const cancelled = () => requireValue(!signal?.aborted, 'backup-cancelled', '還原已取消，現有資料未變更。');
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
    requireValue(card && !card.deleted, 'missing-card', '卡片已不存在。');
    requireValue(card.revision === revision, 'conflict', '卡片已由另一個操作更新；保留目前草稿與轉組意圖。',
      { cardId: id, expectedRevision: revision, actualRevision: card.revision });
    this.#resolved(state, 'card', id);
    return card;
  }

  #resolved(state, kind, id) {
    requireValue(!state.conflicts.some(item => item.kind === 'revision' && item.entityKind === kind && item.entityId === id),
      'conflict', '這筆資料有多個版本，請先處理衝突；目前草稿仍保留。');
  }

  #group(state, id) {
    requireValue(state.groups.some(group => group.id === id && !group.deleted), 'missing-group', '群組不存在或尚待同步。');
    this.#resolved(state, 'group', id);
  }

  #record(state, kind, value, parents) {
    const record = revisionRecord(kind, value, parents);
    requireValue(!state.revisions.some(item => item.revisionId === record.revisionId), 'revision-collision', '版本身分重複，尚未保存。');
    requireValue(parents.every(parent => state.revisions.some(item => item.revisionId === parent
      && item.kind === kind && item.entityId === value.id)), 'missing-parent', '找不到完整的父版本，尚未保存。');
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
      requireValue(index >= 0, 'missing-intent', '這筆轉組意圖已處理。');
      state.conflicts.splice(index, 1);
    });
  }

  async retryTransferIntent(intent, expectedRevision) {
    intent = copy(intent); const key = canonicalJson(intent);
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      requireValue(state.layout.revision === revision, 'stale-layout', '版面已變更，請重試。');
      const index = state.conflicts.findIndex(item => item.kind === 'transfer' && canonicalJson(item) === key);
      requireValue(index >= 0, 'missing-intent', '這筆轉組意圖已處理。');
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
    requireValue(typeof sourceId === 'string' && sourceId.length > 0, 'invalid-source', '需要明確的來源身分。');
    return this.#commit(state => {
      requireValue(!state.sync.sourceId || state.sync.sourceId === sourceId, 'source-mismatch', '不同帳號或來源必須使用獨立工作空間。');
      state.sync.sourceId = sourceId; state.sync.sessionId = this.#uuid();
      return { profileId: state.profileId, sourceId, sessionId: state.sync.sessionId, runtimeId: this.#runtimeId };
    });
  }

  #session(state, session) {
    requireValue(session && session.runtimeId === this.#runtimeId && session.profileId === state.profileId && session.sourceId === state.sync.sourceId
      && session.sessionId && session.sessionId === state.sync.sessionId,
    'stale-session', '來源連線已結束或帳號已變更，舊回應未寫入。');
  }

  async endSync(session) {
    session = copy(session);
    return this.#commit(state => { this.#session(state, session); state.sync.sessionId = null; });
  }

  async completeSync(session, completedAt) {
    requireValue(typeof completedAt === 'string' && Number.isFinite(Date.parse(completedAt)) && new Date(completedAt).toISOString() === completedAt,
      'invalid-sync-time', '同步完成時間無效。');
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
    requireValue(!previous || canonicalJson(previous) === canonicalJson(file), 'file-changed', '原有同步檔案已被修改，資料仍保留，請處理來源完整性。');
    state.sync.files[file.id] = copy(file);
  }

  async reserveUpload(session, key, file) {
    session = copy(session); file = validateFile(file);
    if (file.kind === 'revision') {
      const record = this.#graph.get(key);
      requireValue(record, 'missing-revision', '找不到待同步版本。');
      const bytes = encodeSourceRevision(record, resetFileIds(this.#state.sync.files));
      requireValue(file.size === bytes.byteLength && file.sha256 === await sha256(bytes), 'upload-mismatch', '待同步檔案與不可變版本不符。');
    } else requireValue(validDigest(key) && key === file.sha256, 'upload-mismatch', '附件必須以內容校驗值定址。');
    return this.#commit(state => {
      this.#session(state, session); state.sync.uploads ||= {};
      const operation = `${file.kind}:${key}`;
      const existing = state.sync.uploads[operation];
      if (existing) {
        requireValue(existing.file.kind === file.kind && existing.file.sha256 === file.sha256 && existing.file.size === file.size,
          'upload-mismatch', '重試的檔案內容與原始操作不符。');
        return copy(existing);
      }
      if (file.kind === 'revision') requireValue(state.outbox.some(item => item.operationId === key), 'missing-outbox', '這筆版本已同步或不在待送清單。');
      requireValue(!Object.values(state.sync.uploads).some(item => item.file.id === file.id) && !Object.hasOwn(state.sync.files || {}, file.id),
        'file-id-collision', '來源配置了已使用的檔案身分，尚未上傳。');
      const upload = { file, complete: false };
      state.sync.uploads[operation] = copy(upload); return copy(upload);
    });
  }

  async completeUpload(session, operation, fileId) {
    session = copy(session);
    return this.#commit(state => {
      this.#session(state, session);
      const upload = state.sync.uploads?.[operation];
      requireValue(safeKey(operation) && upload?.file?.id === fileId, 'upload-mismatch', '上傳回應不屬於目前操作。');
      upload.complete = true; this.#file(state, upload.file);
      if (upload.file.kind === 'revision') state.outbox = state.outbox.filter(entry => `revision:${entry.operationId}` !== operation);
    });
  }

  async receiveRevisions(records, { session, expectedCursor, cursor, files = [] }) {
    records = records.map(validateRevision); session = copy(session);
    files = files.map(validateFile);
    requireValue(cursor === null || (typeof cursor === 'string' && cursor.length <= 8192), 'invalid-cursor', '同步游標無效。');
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      this.#session(state, session);
      requireValue(state.sync.cursor === expectedCursor, 'stale-cursor', '已有更新的同步進度，請重新取得游標。');
      requireValue(state.layout.revision === revision, 'stale-layout', '版面已變更，請重試同步。');
      for (const file of files) this.#file(state, file);
      const graph = this.#graph.fork(records);
      const known = new Set(state.revisions.map(item => item.revisionId));
      for (const record of records) if (!known.has(record.revisionId)) {
        state.revisions.push(record); known.add(record.revisionId);
      }
      const result = { added: graph.size - this.#graph.size, pending: graph.pending, missing: graph.missing };
      Object.assign(state, projectRevisions(graph, state));
      state.layout = reconcileSourceLayout(layout, state); state.sync.cursor = cursor;
      if (cursor !== null) state.sync.sourceResetIds = resetFileIds(state.sync.files);
      return { layout: state.layout, value: result };
    }));
  }

  /** Explicitly adopt one observed branch, optionally editing it; old revisions remain in history. */
  async resolveRevisions({ kind, entityId, heads, selectedRevision, patch = {}, fromHistory = false }) {
    heads = copy(heads); patch = copy(patch);
    requireValue(['card', 'group'].includes(kind), 'invalid-kind', '未知的資料種類。');
    const allowed = kind === 'card' ? ['content', 'groupId', 'deleted', 'archived', 'completed'] : ['name', 'deleted', 'redirectGroupId'];
    requireValue(Object.keys(patch).every(key => allowed.includes(key)), 'invalid-command', '衝突決議不可修改身分或版本。');
    return this.#layout.integrateSource((layout, revision) => this.#commit(state => {
      requireValue(state.layout.revision === revision, 'stale-layout', '版面已變更，請重試。');
      const current = this.#graph.heads(kind, entityId);
      requireValue(Array.isArray(heads) && new Set(heads).size === heads.length
        && JSON.stringify([...heads].sort()) === JSON.stringify(current.map(item => item.revisionId).sort()),
      'stale-resolution', '預覽後版本已變更，請重新比較再決定。');
      const selected = fromHistory ? this.#graph.get(selectedRevision) : current.find(item => item.revisionId === selectedRevision);
      requireValue(selected && selected.kind === kind && selected.entityId === entityId && this.#graph.isComplete(selected.revisionId),
        'missing-revision', '找不到完整的所選版本。');
      const value = { ...copy(selected.value), ...patch, revision: this.#uuid() };
      if (kind === 'card') {
        value.groupId = resolveGroupId(state, value.groupId); this.#group(state, value.groupId);
      } else if (!value.deleted) {
        delete value.redirectGroupId;
        if (!state.groups.some(group => group.id === value.id && !group.deleted)) validateNewGroup(state);
      } else {
        value.redirectGroupId = resolveGroupId(state, value.redirectGroupId);
        requireValue(value.redirectGroupId !== value.id, 'group-cycle', '接收群組不能再導回自己。');
      }
      this.#record(state, kind, value, heads);
      const graph = this.#graph.fork([state.revisions.at(-1)]);
      Object.assign(state, projectRevisions(graph, state));
      state.layout = reconcileSourceLayout(layout, state);
      return { layout: state.layout, value: copy(value) };
    }));
  }

  async createGroup(name) {
    requireValue(typeof name === 'string' && name.trim(), 'invalid-name', '請輸入群組名稱。');
    return this.#commit(state => {
      validateNewGroup(state);
      const group = { id: this.#uuid(), revision: this.#uuid(), name: name.trim(), deleted: false };
      state.groups.push(group); this.#record(state, 'group', group, []);
      return copy(group);
    });
  }

  /** After a complete pull, every device derives the same initial root for this account and reset generation. */
  async ensureInitialGroup(session) {
    session = copy(session); this.#session(this.#state, session);
    if (this.#state.revisions.length || this.#state.groups.length) return null;
    const resets = canonicalJson(resetFileIds(this.#state.sync.files));
    const record = await initialGroupRecord(session.sourceId, resetFileIds(this.#state.sync.files));
    return this.#commit(state => {
      this.#session(state, session);
      requireValue(state.sync.cursor !== null && canonicalJson(resetFileIds(state.sync.files)) === resets,
        'initial-sync-required', '請先完成 Google 同步，再新增便箋。');
      if (state.revisions.length || state.groups.length) return null;
      const group = record.value;
      state.groups.push(group); this.#record(state, 'group', group, []);
      return copy(group);
    });
  }

  async renameGroup(id, name, expectedRevision) {
    requireValue(typeof name === 'string' && name.trim(), 'invalid-name', '請輸入群組名稱。');
    return this.#commit(state => {
      this.#group(state, id);
      const group = state.groups.find(group => group.id === id);
      requireValue(group.revision === expectedRevision, 'conflict', '群組已更新，請重試。');
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
      requireValue(state.layout.revision === layoutRevision, 'stale-layout', '版面已變更，請重試。');
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
      'invalid-command', '卡片更新不可修改身分、版本或群組。');
    if ('content' in patch) contentValue(patch.content);
    for (const key of ['archived', 'completed', 'deleted']) {
      requireValue(!(key in patch) || typeof patch[key] === 'boolean', 'invalid-command', '卡片狀態必須是布林值。');
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
    requireValue(original, 'missing-draft', '找不到這份草稿。');
    return { ...copy(original), id: this.#uuid(), recoveredFrom: [
      ...(original.recoveredFrom || []), { id: original.id, baseline: draftBaseline(original) },
    ] };
  }

  async commitDraft(draftId, { asCopy = false } = {}) {
    return this.#commit(state => {
      const draft = state.drafts[draftId];
      requireValue(draft, 'missing-draft', '找不到已保存的草稿。');
      this.#group(state, draft.groupId);
      let card;
      if (draft.baseRevision && !asCopy) {
        card = this.#card(state, draft.cardId, draft.baseRevision);
        card.content = copy(draft.content); card.revision = this.#uuid();
        this.#record(state, 'card', card, [draft.baseRevision]);
      } else {
        const id = asCopy ? this.#uuid() : draft.cardId;
        requireValue(!state.cards.some(existing => existing.id === id), 'duplicate-card', '卡片身分已存在，請另存副本。');
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
      requireValue(card && card.deleted && card.revision === expectedRevision, 'conflict', '刪除區卡片已變更，請重新載入。');
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
        requireValue(state.layout.revision === layoutRevision, 'stale-layout', '版面已變更。');
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
      requireValue(state.layout.revision === layoutRevision, 'stale-layout', '版面已變更。');
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
    requireValue(safeKey(draft.id) && safeKey(draft.cardId), 'invalid-draft', '草稿身分無效。');
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
