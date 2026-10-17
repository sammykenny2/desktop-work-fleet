import { copy, requireValue } from '../core/contracts.js';
import { sha256, validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';

const CHUNK = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function base64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 16384) value += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(value);
}
function decode(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }

export class NativeTransfers {
  #bridge; #info;
  constructor(bridge, info) { this.#bridge = bridge; this.#info = info; }
  async discard(token) { if (token) await this.#bridge.request('transfer.discard', { token }).catch(() => {}); }
  async upload(kind, bytes, signal) {
    requireValue(bytes.length <= (kind === 'backup' ? this.#info.maxBackupBytes : kind === 'attachment' ? this.#info.maxAttachmentBytes : this.#info.maxRecordBytes),
      'native-capacity', t('errors.storage.nativeCapacity'));
    signal?.throwIfAborted(); const sha = await sha256(bytes); signal?.throwIfAborted();
    const upload = await this.#bridge.request('transfer.begin', { kind, size: bytes.length, sha256: sha });
    try {
      for (let offset = 0; offset < bytes.length; offset += CHUNK) {
        signal?.throwIfAborted(); const chunk = bytes.subarray(offset, offset + CHUNK);
        const reply = await this.#bridge.request('transfer.append', { token: upload.token, offset, base64: base64(chunk) });
        requireValue(reply.offset === offset + chunk.length, 'transfer-offset', t('errors.storage.transferOrder'));
      }
      signal?.throwIfAborted(); return (await this.#bridge.request('transfer.finish', { token: upload.token })).token;
    } finally { await this.discard(upload.token); }
  }
  async download(method, args, maximum = this.#info.maxRecordBytes) {
    const value = await this.#bridge.request(method, args);
    if (value === null) return null;
    try {
      requireValue(Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= maximum && validDigest(value.sha256),
        'transfer-size', t('errors.storage.downloadSizeInvalid'));
      const bytes = new Uint8Array(value.size);
      for (let offset = 0; offset < value.size; offset += CHUNK) {
        const reply = await this.#bridge.request('transfer.read', { token: value.token, offset }); const chunk = decode(reply.base64);
        requireValue(reply.offset === offset && chunk.length === Math.min(CHUNK, value.size - offset)
          && reply.done === (offset + chunk.length === value.size), 'transfer-offset', t('errors.storage.downloadOrder'));
        bytes.set(chunk, offset);
      }
      requireValue(await sha256(bytes) === value.sha256, 'transfer-integrity', t('errors.storage.downloadChecksum')); return bytes;
    } finally { await this.discard(value.token); }
  }
}

export class NativeStorage {
  #bridge; #profile; #info; #transfers;
  constructor(bridge, info) {
    this.#bridge = bridge; this.#profile = info.profileId; this.#info = info; this.#transfers = new NativeTransfers(bridge, info);
  }
  close() { this.#bridge.close(); }
  #check(profileId) { requireValue(profileId === this.#profile, 'invalid-profile', t('errors.storage.profileMismatch')); }
  #upload(kind, bytes) { return this.#transfers.upload(kind, bytes); }
  #download(method, args) { return this.#transfers.download(method, args); }
  #discard(token) { return this.#transfers.discard(token); }
  async load(profileId, kind = 'workspace') {
    this.#check(profileId); const bytes = await this.#download('storage.load', { kind });
    return bytes === null ? null : JSON.parse(decoder.decode(bytes));
  }
  save(state, expectedRevision) { return this.#save(state, expectedRevision, [], 'workspace'); }
  saveJournal(state, expectedRevision) { return this.#save(state, expectedRevision, [], 'journal'); }
  saveWithAttachments(state, expectedRevision, attachments, { replaceAttachments = false } = {}) {
    return this.#save(state, expectedRevision, attachments, 'workspace', replaceAttachments);
  }
  async #save(state, expectedRevision, attachments, kind, replaceAttachments = false) {
    state = copy(state); this.#check(state.profileId);
    requireValue(typeof replaceAttachments === 'boolean' && (!replaceAttachments || (kind === 'workspace' && !state.profileId.startsWith('google:'))),
      'invalid-request', t('errors.common.localRestoreOnly'));
    requireValue(Array.isArray(attachments) && attachments.length <= 20000, 'invalid-attachment', t('errors.storage.attachmentListInvalid'));
    attachments = attachments.map(item => {
      requireValue(item?.bytes instanceof Uint8Array && validDigest(item.id), 'invalid-attachment', t('errors.common.attachmentInvalid'));
      return { id: item.id, bytes: new Uint8Array(item.bytes) };
    });
    requireValue(new Set(attachments.map(item => item.id)).size === attachments.length, 'invalid-attachment', t('errors.storage.attachmentIdDuplicate'));
    const bytes = encoder.encode(JSON.stringify(state)); const tokens = []; let token;
    try {
      for (const item of attachments) {
        requireValue(await sha256(item.bytes) === item.id, 'attachment-integrity', t('errors.common.attachmentChecksumMismatch'));
        tokens.push(await this.#upload('attachment', item.bytes));
      }
      token = await this.#upload(kind, bytes);
      try { await this.#bridge.request('storage.commit', { kind, token, expectedRevision, attachments: tokens, replaceAttachments }); }
      catch (error) {
        // A lost acknowledgement is not a rollback. Confirm the complete next record before publishing it.
        if (error.code !== 'native-outcome-unknown') throw error;
        const saved = await this.#download('storage.load', { kind }).catch(() => null);
        if (!saved || saved.length !== bytes.length || await sha256(saved) !== await sha256(bytes)) throw error;
      }
    } finally { await this.#discard(token); for (const item of tokens) await this.#discard(item); }
  }
  async putAttachment(profileId, file) {
    this.#check(profileId);
    requireValue(file instanceof Blob && file.size <= this.#info.maxAttachmentBytes, 'attachment-size', t('errors.common.attachmentTooLarge'));
    const bytes = new Uint8Array(await file.arrayBuffer()); const id = await sha256(bytes);
    await this.putAttachmentBytes(profileId, id, bytes);
    return { id, size: file.size, name: file.name || 'attachment', mediaType: file.type || 'application/octet-stream' };
  }
  async putAttachmentBytes(profileId, id, bytes) {
    this.#check(profileId);
    requireValue(bytes instanceof Uint8Array && validDigest(id), 'invalid-attachment', t('errors.common.attachmentInvalid')); bytes = new Uint8Array(bytes);
    requireValue(await sha256(bytes) === id, 'attachment-integrity', t('errors.common.attachmentChecksumMismatch'));
    const token = await this.#upload('attachment', bytes);
    try { const result = await this.#bridge.request('storage.putAttachment', { token }); requireValue(result.id === id, 'attachment-integrity', t('errors.storage.attachmentSaveChecksum')); }
    finally { await this.#discard(token); }
  }
  async getAttachment(profileId, id) {
    this.#check(profileId); requireValue(validDigest(id), 'invalid-attachment', t('errors.common.attachmentIdInvalid'));
    const bytes = await this.#download('storage.attachment', { id });
    if (bytes === null) return null;
    requireValue(bytes.length <= this.#info.maxAttachmentBytes && await sha256(bytes) === id, 'attachment-integrity', t('errors.storage.attachmentChecksumFailed'));
    return new Blob([bytes], { type: 'application/octet-stream' });
  }
  /** Deletes this profile's data on the device; the host then reopens the document on the same, empty profile. */
  async reset(profileId) { this.#check(profileId); await this.#bridge.request('storage.reset'); }
  journal() {
    return { load: profileId => this.load(profileId, 'journal'), save: (state, revision) => this.saveJournal(state, revision), close() {} };
  }
}
