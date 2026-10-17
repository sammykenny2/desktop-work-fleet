import { FleetError, requireValue } from '../core/contracts.js';
import { canonicalJson, parseJson } from '../sources/json.js';
import { BACKUP_LIMITS, checkCancelled, packZip, unpackZip } from './archive.js';
import { schemas, requireSchemaVersion } from '../core/schema.js';
import { t } from '../i18n/index.js';

const ITERATIONS = 600000;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const unhex = text => Uint8Array.from(text.match(/../g), value => Number.parseInt(value, 16));
const encoded = value => new TextEncoder().encode(canonicalJson(value));

function validateHeader(value) {
  requireSchemaVersion(value, 'encryptedBackup', { code: 'unsupported-backup-encryption' });
  requireValue(value && Object.keys(value).sort().join(',') === 'cipher,format,iterations,kdf,nonce,salt,schemaVersion,tagBits'
    && value.format === 'work-fleet-encrypted-backup' && value.cipher === 'AES-256-GCM'
    && value.kdf === 'PBKDF2-HMAC-SHA256' && value.iterations === ITERATIONS && value.tagBits === 128
    && typeof value.salt === 'string' && /^[0-9a-f]{32}$/.test(value.salt)
    && typeof value.nonce === 'string' && /^[0-9a-f]{24}$/.test(value.nonce),
  'unsupported-backup-encryption', t('errors.backup.encryptionUnsupported'));
  return value;
}

async function derive(password, salt, signal) {
  requireValue(typeof password === 'string' && password.length > 0 && password.length <= 1024,
    'backup-password', t('errors.backup.passwordRequired'));
  canonicalJson(password); const bytes = new TextEncoder().encode(password);
  try {
    checkCancelled(signal);
    const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    checkCancelled(signal); return key;
  } finally { bytes.fill(0); }
}

/** Validate a trusted native encryptor's envelope shape; never accept a plaintext fallback as encrypted. */
export async function validateEncryptedBackup(bytes, options = {}) {
  requireValue(bytes instanceof Uint8Array, 'unsupported-backup-encryption', t('errors.backup.nativeEncryptionIncomplete'));
  const entries = await unpackZip(bytes, options);
  requireValue(entries.size === 2 && entries.has('encryption.json') && entries.has('payload.bin'),
    'unsupported-backup-encryption', t('errors.backup.nativeEncryptionNotEncrypted'));
  validateHeader(parseJson(entries.get('encryption.json')));
  requireValue(entries.get('payload.bin').length >= 16, 'unsupported-backup-encryption', t('errors.backup.encryptedContentIncomplete'));
}

/** Authenticated envelope around a complete ZIP; public headers contain no content or account metadata. */
export async function encryptBackup(input, password, options = {}) {
  requireValue(input instanceof Uint8Array && input.length <= BACKUP_LIMITS.zipBytes,
    'backup-limit', t('errors.backup.encryptionTooLarge'));
  requireValue(typeof password === 'string' && password.length <= 1024 && [...password].length >= 12,
    'backup-password', t('errors.backup.passwordLength'));
  const bytes = new Uint8Array(input); checkCancelled(options.signal);
  const header = validateHeader({ format: 'work-fleet-encrypted-backup', schemaVersion: schemas.encryptedBackup, cipher: 'AES-256-GCM',
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
    'unsupported-backup-encryption', t('errors.backup.encryptedPackageInvalid'));
  requireValue(entries.get('encryption.json') instanceof Uint8Array && entries.get('encryption.json').length <= 4096,
    'unsupported-backup-encryption', t('errors.backup.encryptionHeaderInvalid'));
  const header = validateHeader(parseJson(entries.get('encryption.json'))); const aad = encoded(header);
  const input = entries.get('payload.bin');
  requireValue(input instanceof Uint8Array && input.length >= 16 && input.length <= BACKUP_LIMITS.zipBytes + 16,
    'backup-limit', t('errors.backup.encryptedSizeInvalid'));
  const ciphertext = new Uint8Array(input); options.progress?.({ phase: 'decrypt', completed: 0, total: 1 });
  const key = await derive(password, unhex(header.salt), options.signal);
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(header.nonce), additionalData: aad, tagLength: 128 }, key, ciphertext));
  } catch { throw new FleetError('backup-decryption', t('errors.backup.decryptionFailed')); }
  try {
    checkCancelled(options.signal); const result = await unpackZip(bytes, options);
    requireValue(!result.has('encryption.json'), 'unsupported-backup-encryption', t('errors.backup.nestedEncryption'));
    options.progress?.({ phase: 'decrypt', completed: 1, total: 1 }); return result;
  } finally { bytes.fill(0); }
}
