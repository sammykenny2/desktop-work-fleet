import { NativeTransfers } from '../storage/native.js';
import { requireValue } from '../core/contracts.js';
import { sha256, validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';

export class NativeCaptureInbox {
  #native; #workspace; #storage; #transfers;
  constructor(native, workspace, storage) { this.#native = native; this.#workspace = workspace; this.#storage = storage; this.#transfers = new NativeTransfers(native.bridge, native.info); }
  async list() {
    const items = await this.#native.bridge.request('capture.list');
    requireValue(Array.isArray(items) && items.length <= 64, 'capture-capacity', t('errors.storage.captureListSize'));
    for (const item of items) requireValue(typeof item.id === 'string' && validDigest(item.receipt) && typeof item.preview === 'string' && item.preview.length <= 220 && Number.isInteger(item.fileCount) && item.fileCount >= 0 && item.fileCount <= 16, 'capture-invalid', t('errors.storage.captureListInvalid'));
    return items.sort((a, b) => b.receivedAt - a.receivedAt);
  }
  async item(id) {
    const bytes = await this.#transfers.download('capture.item', { id }, 2 * 1024 * 1024 + 4096);
    const item = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    requireValue(item.v === 1 && item.id === id && validDigest(item.receipt) && typeof item.text === 'string' && new TextEncoder().encode(item.text).length <= 256 * 1024 && Array.isArray(item.attachments) && item.attachments.length <= 16,
      'capture-invalid', t('errors.storage.captureItemInvalid'));
    let total = 0;
    for (const file of item.attachments) {
      requireValue(validDigest(file.id) && typeof file.fileId === 'string' && typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 360 && typeof file.type === 'string' && file.type.length <= 320 && Number.isSafeInteger(file.size) && file.size >= 0, 'capture-invalid', t('errors.storage.captureAttachmentInvalid'));
      total += file.size;
    }
    requireValue(total <= 25 * 1024 * 1024, 'capture-capacity', t('errors.storage.captureAttachmentsTooLarge')); return item;
  }
  async discard(item) { await this.#native.bridge.request('capture.ack', { id: item.id, receipt: item.receipt }); }
  // A share becomes a new note with unsaved changes in the chosen group (ADR-061); `unsaved` says the note is not saved yet.
  async accept(item, groupId) {
    const matches = value => value.content?.nativeCapture?.id === item.id && value.content.nativeCapture.receipt === item.receipt && value.content.nativeCapture.platform === this.#native.info.platform;
    const previousDraft = Object.values(this.#workspace.state.drafts).find(matches);
    const previousCard = this.#workspace.snapshot.cards.find(matches);
    if (previousDraft || previousCard) {
      await this.discard(item);
      return { cardId: previousCard?.id ?? previousDraft.cardId, unsaved: !previousCard, alreadyReceived: true };
    }
    const draft = this.#workspace.blankDraft(groupId); draft.content.text = item.text;
    draft.content.nativeCapture = { id: item.id, receipt: item.receipt, platform: this.#native.info.platform };
    for (const file of item.attachments) {
      const bytes = await this.#transfers.download('capture.attachment', { id: item.id, fileId: file.fileId }, 25 * 1024 * 1024);
      requireValue(bytes.length === file.size && await sha256(bytes) === file.id, 'capture-integrity', t('errors.storage.captureAttachmentIntegrity'));
      await this.#storage.putAttachmentBytes(this.#native.info.profileId, file.id, bytes);
      if (!draft.content.attachments.some(value => value.id === file.id)) draft.content.attachments.push({ id: file.id, name: file.name, type: file.type, size: file.size });
    }
    await this.#workspace.saveDraft(draft);
    await this.discard(item); return { cardId: draft.cardId, unsaved: true, alreadyReceived: false };
  }
}
