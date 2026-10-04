import { FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { BACKUP_LIMITS, checkCancelled, packZip, unpackZip } from './archive.js';

const ITERATIONS = 600000;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), value => Number.parseInt(value, 16));
const encoded = value => new TextEncoder().encode(canonicalJson(value));

function validateHeader(value) {
  requireValue(value && Object.keys(value).sort().join(',') === 'cipher,format,iterations,kdf,nonce,salt,schemaVersion,tagBits'
    && value.format === 'work-fleet-encrypted-backup' && value.schemaVersion === 1 && value.cipher === 'AES-256-GCM'
    && value.kdf === 'PBKDF2-HMAC-SHA256' && value.iterations === ITERATIONS && value.tagBits === 128
    && typeof value.salt === 'string' && /^[0-9a-f]{32}$/.test(value.salt)
    && typeof value.nonce === 'string' && /^[0-9a-f]{24}$/.test(value.nonce),
  'unsupported-backup-encryption', '備份加密格式或參數不受支援，尚未嘗試還原。');
  return value;
}

async function derive(password, salt, signal) {
  requireValue(typeof password === 'string' && password.length > 0 && password.length <= 1024,
    'backup-password', '請輸入備份密碼，最多 1,024 字元。');
  canonicalJson(password); const bytes = new TextEncoder().encode(password);
  try {
    checkCancelled(signal);
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    checkCancelled(signal); return key;
  } finally { bytes.fill(0); }
}

/** Authenticated envelope around a complete ZIP; public headers contain no content or account metadata. */
export async function encryptBackup(input, password, options = {}) {
  requireValue(input instanceof Uint8Array && input.length <= BACKUP_LIMITS.zipBytes,
    'backup-limit', '待加密備份超過容量上限。');
  requireValue(typeof password === 'string' && password.length <= 1024 && [...password].length >= 12,
    'backup-password', '備份密碼至少需要 12 個字元，最多 1,024 字元。');
  const bytes = new Uint8Array(input); checkCancelled(options.signal);
  const header = validateHeader({ format: 'work-fleet-encrypted-backup', schemaVersion: 1, cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-HMAC-SHA256', iterations: ITERATIONS, salt: hex(crypto.getRandomValues(new Uint8Array(16))),
    nonce: hex(crypto.getRandomValues(new Uint8Array(12))), tagBits: 128 });
  const aad = encoded(header);
  try {
    options.progress?.({ phase: 'encrypt', completed: 0, total: 1 });
    const key = await derive(password, unhex(header.salt), options.signal);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: unhex(header.nonce), additionalData: aad, tagLength: 128 }, key, bytes));
    checkCancelled(options.signal);
    const result = await packZip(new Map([['encryption.json', aad], ['payload.bin', ciphertext]]), options);
    options.progress?.({ phase: 'encrypt', completed: 1, total: 1 }); return result;
  } finally { bytes.fill(0); }
}

/** Fully verify the envelope before exposing any plaintext. No partial decrypted output is returned. */
export async function decryptBackup(entries, password, options = {}) {
  requireValue(entries instanceof Map && entries.size === 2 && entries.has('encryption.json') && entries.has('payload.bin'),
    'unsupported-backup-encryption', '加密備份封裝無效。');
  requireValue(entries.get('encryption.json') instanceof Uint8Array && entries.get('encryption.json').length <= 4096,
    'unsupported-backup-encryption', '備份加密 header 無效。');
  const header = validateHeader(parseJson(entries.get('encryption.json'))); const aad = encoded(header);
  const input = entries.get('payload.bin');
  requireValue(input instanceof Uint8Array && input.length >= 16 && input.length <= BACKUP_LIMITS.zipBytes + 16,
    'backup-limit', '加密內容大小無效。');
  const ciphertext = new Uint8Array(input); options.progress?.({ phase: 'decrypt', completed: 0, total: 1 });
  const key = await derive(password, unhex(header.salt), options.signal);
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(header.nonce), additionalData: aad, tagLength: 128 }, key, ciphertext));
  } catch { throw new FleetError('backup-decryption', '密碼不正確或加密備份已損壞；沒有還原任何內容。'); }
  try {
    checkCancelled(options.signal); const result = await unpackZip(bytes, options);
    requireValue(!result.has('encryption.json'), 'unsupported-backup-encryption', '不支援巢狀加密備份。');
    options.progress?.({ phase: 'decrypt', completed: 1, total: 1 }); return result;
  } finally { bytes.fill(0); }
}
