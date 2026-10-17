// Durable drafts are independent records so two tabs cannot overwrite each other's work.
export const statuses = { todo: 'Todo', in_progress: 'In Progress', done: 'Done' };
const prefix = 'wf.v1.';
export class Drafts {
  constructor(storage, uuid = () => crypto.randomUUID()) {
    this.storage = storage;
    this.uuid = uuid;
  }
  list() {
    const result = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key.startsWith(prefix + 'draft.')) {
        try { result.push(JSON.parse(this.storage.getItem(key))); } catch { /* keep unreadable records on disk */ }
      }
    }
    return result;
  }
  write(draft) {
    this.storage.setItem(prefix + 'draft.' + draft.key, JSON.stringify(draft));
    return draft;
  }
  blank(snapshot, note = null) {
    return { key: this.uuid(), id: note?.id || this.uuid(), epoch: snapshot.epoch,
      revision: note?.revision || null, text: note?.text || '', board: note?.board || 'Inbox',
      status: note?.status || 'todo', original: note, pending: null };
  }
  create(snapshot, note = null) { return this.write(this.blank(snapshot, note)); }
  edit(draft, patch) {
    if (draft.pending) throw new Error('Retry the last send first, or keep this draft as a new copy.');
    return this.write({ ...draft, ...patch });
  }
  prepare(draft) {
    if (draft.pending) return draft;
    const common = { id: draft.id, epoch: draft.epoch, operation: this.uuid() };
    const pending = draft.revision
      ? { ...common, action: 'update', revision: draft.revision,
          patch: { text: draft.text, board: draft.board, status: draft.status } }
      : { ...common, action: 'create', text: draft.text, board: draft.board, status: draft.status };
    return this.write({ ...draft, pending });
  }
  action(snapshot, note, action) {
    const draft = this.create(snapshot, note);
    return this.write({ ...draft, pending: { id: note.id, epoch: snapshot.epoch, revision: note.revision,
      operation: this.uuid(), action } });
  }
  copy(draft, epoch) {
    // Keep the original until the user explicitly discards it.
    return this.write({ ...draft, key: this.uuid(), id: this.uuid(), epoch,
      revision: null, original: null, pending: null });
  }
  recover(draft) {
    // Each tab owns a new record, including when resuming a pending request.
    return this.write({ ...draft, key: this.uuid() });
  }
  remove(draft) { this.storage.removeItem(prefix + 'draft.' + draft.key); }
}
export const cacheKey = prefix + 'cache';
export const credentialKey = prefix + 'credential';
