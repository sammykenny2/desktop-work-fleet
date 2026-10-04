import { activeGroups, copy, FleetError, membershipKey, requireValue, safeKey, validateNewGroup } from './contracts.js';
import { createLayout, LayoutStore } from '../layout/store.js';

function contentValue(content) {
  requireValue(content && typeof content.text === 'string' && typeof content.format === 'string',
    'invalid-content', '便箋需要文字及格式。');
  // Preserve extension data and attachments; adapters must not reduce an unknown format to text.
  return copy(content);
}

/** Account-scoped local journal. The persistence boundary includes content, outbox, drafts and layout. */
export class Workspace {
  #state;
  #persist;
  #uuid;
  #tail = Promise.resolve();
  #layout;

  static async create({ profileId, deviceId, area, persist, uuid = () => crypto.randomUUID() }) {
    const group = { id: uuid(), name: '我的便箋', revision: uuid(), deleted: false };
    const state = { schemaVersion: 1, profileId, revision: 0, groups: [group], cards: [],
      drafts: {}, outbox: [{ operationId: group.revision, kind: 'group', entityId: group.id,
        parents: [], value: copy(group) }], conflicts: [], layout: createLayout(deviceId, [group], area) };
    await persist(copy(state), null);
    return new Workspace(state, persist, uuid);
  }

  constructor(state, persist, uuid = () => crypto.randomUUID()) {
    requireValue(state.schemaVersion === 1, 'unsupported-schema', '此資料版本需要較新版 App。');
    this.#state = copy(state); this.#persist = persist; this.#uuid = uuid;
    this.#layout = new LayoutStore(state.layout, (layout, revision, validation) => this.#commit(draft => {
      requireValue(draft.layout.revision === revision, 'stale-layout', '版面已由另一個寫入者變更。');
      if (validation?.membership) requireValue(validation.membership === membershipKey(draft, draft.layout),
        'stale-plan', '預覽後資料已變更，請重新預覽。');
      draft.layout = copy(layout);
    }));
  }

  get snapshot() { return { groups: copy(this.#state.groups), cards: copy(this.#state.cards), writable: true,
    conflicts: copy(this.#state.conflicts) }; }
  get state() { return copy(this.#state); }
  get layout() { return this.#layout; }

  #commit(change) {
    const operation = this.#tail.then(async () => {
      const draft = copy(this.#state);
      const result = change(draft);
      draft.revision++;
      await this.#persist(copy(draft), this.#state.revision);
      this.#state = draft;
      return result;
    });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  #card(state, id, revision) {
    const card = state.cards.find(card => card.id === id);
    requireValue(card && !card.deleted, 'missing-card', '卡片已不存在。');
    requireValue(card.revision === revision, 'conflict', '卡片已由另一個操作更新；保留目前草稿與轉組意圖。',
      { cardId: id, expectedRevision: revision, actualRevision: card.revision });
    return card;
  }

  #group(state, id) {
    requireValue(state.groups.some(group => group.id === id && !group.deleted), 'missing-group', '群組不存在或尚待同步。');
  }

  #record(state, kind, value, parents) {
    state.outbox.push({ operationId: value.revision, kind, entityId: value.id, parents, value: copy(value) });
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

  async createCard(content, groupId = activeGroups(this.#state)[0]?.id) {
    const value = contentValue(content);
    return this.#commit(state => {
      this.#group(state, groupId);
      const card = { id: this.#uuid(), revision: this.#uuid(), groupId, content: value,
        deleted: false, archived: false, completed: false };
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
    return this.#commit(state => { state.drafts[draft.id] = copy(draft); });
  }
}
