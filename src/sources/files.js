import { copy, requireValue, safeKey } from '../core/contracts.js';

export const validDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const validFileId = value => safeKey(value) && /^[A-Za-z0-9_-]{1,256}$/.test(value);
// A reset marker is a small note that a device cleared the account's files; see resetSource.
export const fileLimit = kind => kind === 'revision' ? 8 * 1024 * 1024 : kind === 'reset' ? 4096 : 25 * 1024 * 1024;

export async function sha256(bytes) {
  requireValue(bytes instanceof Uint8Array, 'invalid-bytes', '檔案內容必須是 bytes。');
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateFile(file) {
  requireValue(file && validFileId(file.id) && ['revision', 'attachment', 'reset'].includes(file.kind)
    && validDigest(file.sha256) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= fileLimit(file.kind),
  'invalid-source-file', '同步檔案的身分、格式或容量無效；本機資料仍保留。');
  return { id: file.id, kind: file.kind, sha256: file.sha256, size: file.size };
}

export async function verifyFile(file, bytes) {
  file = validateFile(file);
  requireValue(bytes instanceof Uint8Array && bytes.byteLength === file.size,
    'file-integrity', '同步檔案內容與校驗值不符，尚未套用。');
  bytes = copy(bytes);
  requireValue(await sha256(bytes) === file.sha256,
    'file-integrity', '同步檔案內容與校驗值不符，尚未套用。');
  return bytes;
}
