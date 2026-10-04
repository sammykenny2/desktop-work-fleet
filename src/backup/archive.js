import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { FleetError, requireValue } from '../core/contracts.js';

const MiB = 1024 * 1024;
export const BACKUP_LIMITS = Object.freeze({ entries: 20000, expandedBytes: 128 * MiB,
  zipBytes: 136 * MiB, encryptedBytes: 136 * MiB + 4096, jsonBytes: 8 * MiB, attachmentBytes: 25 * MiB });
export const checkCancelled = signal => requireValue(!signal?.aborted, 'backup-cancelled', '備份工作已取消，現有資料未變更。');
export async function yieldBackup(signal) { checkCancelled(signal); await new Promise(resolve => setTimeout(resolve, 0)); checkCancelled(signal); }
export function backupScheduler(signal) {
  let last = performance.now();
  return async () => {
    checkCancelled(signal);
    if (performance.now() - last >= 8) { await yieldBackup(signal); last = performance.now(); }
  };
}
const invalid = condition => requireValue(condition, 'invalid-backup-zip', '備份 ZIP 結構無效或包含不支援的檔案。');
const limit = condition => requireValue(condition, 'backup-limit', '備份超過格式的容量或項目上限，尚未截斷或匯入。');

export function entryLimit(name) {
  requireValue(typeof name === 'string', 'invalid-backup-path', '備份路徑必須是固定名稱。');
  if (['manifest.json', 'local.json', 'layout.json'].includes(name) || /^(revisions|drafts)\/[0-9]{8}\.json$/.test(name)) return BACKUP_LIMITS.jsonBytes;
  if (/^attachments\/[0-9a-f]{64}\.bin$/.test(name)) return BACKUP_LIMITS.attachmentBytes;
  if (name === 'encryption.json') return 4096;
  if (name === 'payload.bin') return BACKUP_LIMITS.zipBytes + 16;
  throw new FleetError('invalid-backup-path', '備份含未允許的路徑；不會解壓到檔案系統。');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  return (updateCrc(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}
function updateCrc(value, bytes) {
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return value;
}

function shape(entries, total) {
  const encrypted = entries.some(entry => entry.name === 'encryption.json' || entry.name === 'payload.bin');
  if (encrypted) invalid(entries.length === 2 && entries.some(entry => entry.name === 'encryption.json') && entries.some(entry => entry.name === 'payload.bin'));
  limit(total <= (encrypted ? BACKUP_LIMITS.zipBytes + 4112 : BACKUP_LIMITS.expandedBytes));
  return encrypted;
}

/** Validate both ZIP directories before decompressing anything. No filesystem extraction. */
function directory(bytes) {
  limit(bytes.length <= BACKUP_LIMITS.encryptedBytes); invalid(bytes.length >= 22);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => { invalid(offset >= 0 && offset + 2 <= bytes.length); return view.getUint16(offset, true); };
  const u32 = offset => { invalid(offset >= 0 && offset + 4 <= bytes.length); return view.getUint32(offset, true); };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  invalid(end >= 0 && end >= bytes.length - 65557 && u32(end) === 0x06054b50);
  const count = u16(end + 10); const start = u32(end + 16); const length = u32(end + 12);
  invalid(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === count && start + length === end);
  limit(count <= BACKUP_LIMITS.entries);
  const entries = []; const names = new Set(); let offset = start; let total = 0;
  const nameAt = (offset, length) => {
    invalid(offset >= 0 && offset + length <= bytes.length && length <= 128);
    const raw = bytes.subarray(offset, offset + length); invalid(raw.every(byte => byte >= 32 && byte <= 126));
    const name = String.fromCharCode(...raw);
    entryLimit(name); return name;
  };
  const extraAt = (offset, length) => {
    const end = offset + length; invalid(end <= bytes.length);
    while (offset < end) {
      invalid(offset + 4 <= end); const tag = u16(offset); const size = u16(offset + 2);
      // ZIP64, alternate Unicode paths and platform link metadata are outside this format.
      invalid([0x5455, 0x000a, 0x7875].includes(tag) && offset + 4 + size <= end); offset += 4 + size;
    }
  };
  for (let index = 0; index < count; index++) {
    invalid(offset + 46 <= end && u32(offset) === 0x02014b50 && u16(offset + 6) <= 20);
    const flags = u16(offset + 8); const method = u16(offset + 10); const crc = u32(offset + 16);
    const compressed = u32(offset + 20); const size = u32(offset + 24); const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30); const commentLength = u16(offset + 32); const attributes = u32(offset + 38);
    invalid((flags & ~0x080e) === 0 && [0, 8].includes(method) && u16(offset + 34) === 0
      && (attributes & 0x10) === 0 && [0, 0x8000].includes((attributes >>> 16) & 0xf000)
      && offset + 46 + nameLength + extraLength + commentLength <= end);
    const name = nameAt(offset + 46, nameLength); invalid(!names.has(name)); names.add(name);
    limit(size <= entryLimit(name)); total += size;
    extraAt(offset + 46 + nameLength, extraLength);
    entries.push({ name, flags, method, crc, compressed, size, local: u32(offset + 42) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  invalid(offset === end); const encrypted = shape(entries, total);
  limit(bytes.length <= (encrypted ? BACKUP_LIMITS.encryptedBytes : BACKUP_LIMITS.zipBytes));
  let previousEnd = 0;
  const ordered = [...entries].sort((a, b) => a.local - b.local);
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]; const nextStart = ordered[index + 1]?.local ?? start;
    const position = entry.local;
    invalid(position === previousEnd && position + 30 <= start && u32(position) === 0x04034b50
      && u16(position + 4) <= 20 && u16(position + 6) === entry.flags && u16(position + 8) === entry.method);
    const nameLength = u16(position + 26); const extraLength = u16(position + 28);
    entry.data = position + 30 + nameLength + extraLength;
    invalid(entry.data + entry.compressed <= start && nameAt(position + 30, nameLength) === entry.name);
    extraAt(position + 30 + nameLength, extraLength);
    const localValues = [u32(position + 14), u32(position + 18), u32(position + 22)];
    const values = [entry.crc, entry.compressed, entry.size];
    invalid(localValues.every((value, index) => value === values[index] || ((entry.flags & 8) && value === 0)));
    previousEnd = entry.data + entry.compressed;
    if (entry.flags & 8) {
      const descriptorLength = nextStart - previousEnd;
      invalid([12, 16].includes(descriptorLength));
      if (descriptorLength === 16) { invalid(u32(previousEnd) === 0x08074b50); previousEnd += 4; }
      invalid(previousEnd + 12 <= start && values.every((value, index) => value === u32(previousEnd + index * 4)));
      previousEnd += 12;
    }
    invalid(previousEnd === nextStart);
    if (entry.method === 0) invalid(entry.compressed === entry.size);
  }
  invalid(previousEnd === start);
  return entries;
}

/** Caller data is snapshotted before the first await; actual output counts enforce declared limits. */
export async function unpackZip(input, { signal, progress = () => {} } = {}) {
  requireValue(input instanceof Uint8Array, 'invalid-backup-zip', '需要 ZIP 檔案 bytes。');
  checkCancelled(signal); limit(input.length <= BACKUP_LIMITS.encryptedBytes);
  const bytes = new Uint8Array(input); const entries = directory(bytes); const result = new Map(); const checkpoint = backupScheduler(signal);
  await yieldBackup(signal);
  let completed = 0;
  for (const entry of entries) {
    await checkpoint(); const output = new Uint8Array(entry.size); let written = 0; let crc = 0xffffffff;
    const consume = chunk => {
      invalid(written + chunk.length <= entry.size); output.set(chunk, written); written += chunk.length;
      crc = updateCrc(crc, chunk);
    };
    if (entry.method === 0) {
      for (let position = 0; position < entry.size; position += 65536) {
        consume(bytes.subarray(entry.data + position, entry.data + Math.min(entry.size, position + 65536))); await checkpoint();
      }
    }
    else {
      let decompressor;
      try { decompressor = new DecompressionStream('deflate-raw'); }
      catch { throw new FleetError('backup-runtime', '此環境不支援嚴格 DEFLATE 解壓，請更新 App 或系統。'); }
      let position = 0;
      const stream = new ReadableStream({ pull(controller) {
        checkCancelled(signal);
        if (position >= entry.compressed) { controller.close(); return; }
        const end = Math.min(position + 1024, entry.compressed);
        controller.enqueue(bytes.subarray(entry.data + position, entry.data + end)); position = end;
      } }).pipeThrough(decompressor);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read(); checkCancelled(signal);
          if (done) break;
          consume(value); await checkpoint();
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error instanceof FleetError) throw error;
        throw new FleetError('invalid-backup-zip', '備份壓縮資料損壞，尚未匯入。');
      } finally { reader.releaseLock(); }
    }
    invalid(written === entry.size && ((crc ^ 0xffffffff) >>> 0) === entry.crc);
    result.set(entry.name, output); progress({ phase: 'read', completed: ++completed, total: entries.length });
  }
  await checkpoint(); checkCancelled(signal); return result;
}

export async function packZip(files, { signal, progress = () => {} } = {}) {
  requireValue(files instanceof Map, 'invalid-backup-zip', '備份 entries 必須明確列出。');
  checkCancelled(signal); limit(files.size <= BACKUP_LIMITS.entries);
  const entries = []; let total = 0;
  for (const [name, input] of files) {
    requireValue(input instanceof Uint8Array, 'invalid-backup-zip', '備份 entry 需要 bytes。');
    limit(input.length <= entryLimit(name)); total += input.length;
    limit(total <= BACKUP_LIMITS.zipBytes + 4112);
    entries.push({ name, bytes: new Uint8Array(input) });
  }
  const encrypted = shape(entries, total); const max = encrypted ? BACKUP_LIMITS.encryptedBytes : BACKUP_LIMITS.zipBytes;
  const chunks = []; let length = 0; let finished = false; const checkpoint = backupScheduler(signal);
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    length += chunk.length; limit(length <= max); chunks.push(chunk); finished = final;
  });
  for (let index = 0; index < entries.length; index++) {
    const { name, bytes } = entries[index];
    const file = name.endsWith('.json') ? new ZipDeflate(name, { level: 1 }) : new ZipPassThrough(name);
    file.mtime = new Date(1980, 0, 1); zip.add(file);
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      file.push(bytes.subarray(offset, Math.min(bytes.length, offset + 65536)), offset + 65536 >= bytes.length);
      if (offset % 262144 === 0) await checkpoint();
    }
    if (!bytes.length) file.push(bytes, true);
    progress({ phase: 'write', completed: index + 1, total: entries.length });
    await checkpoint();
  }
  zip.end(); invalid(finished); checkCancelled(signal);
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  directory(result); return result;
}
