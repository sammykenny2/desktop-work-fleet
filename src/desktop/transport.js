import { requireValue } from '../core/contracts.js';
import { sha256, validDigest } from '../sources/files.js';
import { t } from '../i18n/index.js';

export const CHUNK = 256 * 1024;
export const MAX_FRAME = 128 * 1024 * 1024;
export const MAX_COMMAND = 16 * 1024 * 1024;
export const encode = value => new TextEncoder().encode(JSON.stringify(value));
export const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
const base64 = bytes => {
  let text = '';
  for (let start = 0; start < bytes.length; start += 16384) text += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(text);
};
export async function upload(bridge, prefix, bytes, maximum, discard) {
  requireValue(bytes.length > 0 && bytes.length <= maximum, 'scene-size', t('errors.desktop.transferTooLarge'));
  const value = await bridge.request(`${prefix}.begin`, { size: bytes.length, sha256: await sha256(bytes) });
  try {
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const chunk = bytes.subarray(offset, offset + CHUNK);
      const result = await bridge.request(`${prefix}.append`, { token: value.token, offset, base64: base64(chunk) });
      requireValue(result.offset === offset + chunk.length, 'scene-offset', t('errors.desktop.transferOrder'));
    }
    return value.token;
  } catch (error) { await discard(value.token).catch(() => {}); throw error; }
}
export async function download(value, read, maximum = MAX_FRAME) {
  requireValue(value && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= maximum && validDigest(value.sha256),
    'scene-size', t('errors.desktop.downloadSize'));
  const bytes = new Uint8Array(value.size);
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const reply = await read(offset); const chunk = Uint8Array.from(atob(reply.base64), c => c.charCodeAt(0));
    requireValue(reply.offset === offset && chunk.length === Math.min(CHUNK, bytes.length - offset)
      && reply.done === (offset + chunk.length === bytes.length), 'scene-offset', t('errors.desktop.downloadOrder'));
    bytes.set(chunk, offset);
  }
  requireValue(await sha256(bytes) === value.sha256, 'scene-integrity', t('errors.desktop.frameIntegrity')); return bytes;
}
