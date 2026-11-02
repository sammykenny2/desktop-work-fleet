import { requireValue } from '../core/contracts.js';
import { validFileId } from './files.js';
import { t } from '../i18n/index.js';

export const DELETE_BATCH_BOUNDARY = 'work_fleet_delete';
export const DELETE_BATCH_BYTES = 2 * 1024 * 1024;
export function deleteBatchIds(ids) {
  requireValue(Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && new Set(ids).size === ids.length
    && ids.every(id => validFileId(id) && !['root', 'appDataFolder'].includes(id)),
  'invalid-source-file', t('errors.storage.googleFileIdInvalid'));
  return [...ids];
}
export function deleteBatchRequest(ids) {
  return new TextEncoder().encode(deleteBatchIds(ids).map((id, index) => `--${DELETE_BATCH_BOUNDARY}\r\nContent-Type: application/http\r\nContent-ID: wf-${index}\r\n\r\nDELETE /drive/v3/files/${id} HTTP/1.1\r\n\r\n`).join('')
    + `--${DELETE_BATCH_BOUNDARY}--\r\n`);
}

/** Only acknowledged IDs leave the durable journal. A malformed/lost reply can safely retry those same IDs. */
export function deleteBatchResult(ids, bytes) {
  deleteBatchIds(ids);
  const valid = condition => requireValue(condition, 'invalid-source-response', t('errors.sources.driveResponseInvalid'));
  valid(bytes instanceof Uint8Array && bytes.length <= DELETE_BATCH_BYTES);
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { valid(false); }
  const boundary = /^--([A-Za-z0-9_.=-]{1,200})\r?\n/.exec(body)?.[1]; valid(boundary);
  const parts = body.split(`--${boundary}`); valid(parts.shift() === '' && /^--\s*$/.test(parts.pop()));
  valid(parts.length === ids.length);
  const results = new Map();
  for (const part of parts) {
    const match = /^\r?\n([\s\S]*?)\r?\n\r?\nHTTP\/1\.[01] (\d{3})[^\r\n]*\r?\n([\s\S]*)$/.exec(part);
    valid(match);
    const headers = match[1], identity = /^Content-ID:\s*<?response-wf-(\d+)>?\s*$/im.exec(headers);
    valid(/^Content-Type:\s*application\/http\s*$/im.test(headers) && identity);
    const index = Number(identity[1]), status = Number(match[2]);
    valid(Number.isSafeInteger(index) && index < ids.length && !results.has(index) && status >= 200 && status <= 599);
    let reason;
    const separator = /\r?\n\r?\n/.exec(match[3]);
    if (separator) {
      try { reason = JSON.parse(match[3].slice(separator.index + separator[0].length)).error?.errors?.[0]?.reason; } catch { /* Only the status is needed for unknown errors. */ }
    }
    const code = status === 204 || status === 404 ? null : status === 401 ? 'unauthorized'
      : status === 429 || status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason) ? 'rate-limit'
      : status >= 500 ? 'service-unavailable' : status === 403 ? 'source-permission' : 'source-error';
    results.set(index, { id: ids[index], code });
  }
  return ids.map((id, index) => results.get(index));
}
