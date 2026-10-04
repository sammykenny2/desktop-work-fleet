import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { deflateSync, zipSync } from 'fflate';
import { BACKUP_LIMITS, crc32, packZip, unpackZip } from '../src/backup/archive.js';
import { encryptBackup, decryptBackup } from '../src/backup/encryption.js';

const encode = value => new TextEncoder().encode(value);
const fails = code => error => error.code === code;
const password = 'long passphrase 中文 🔐';
const attachment = `attachments/${'1'.repeat(64)}.bin`;
const sample = () => new Map([['manifest.json', encode('{"emoji":"💡","text":"中文\\n- [ ] task"}')],
  [attachment, new Uint8Array([0, 255, 2, 128])], ['drafts/00000000.json', new Uint8Array()]]);
function metadata(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22; const start = view.getUint32(end + 16, true); let offset = start;
  const entries = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    entries.push({ central: offset, local: view.getUint32(offset + 42, true) });
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return { view, start, end, entries };
}
function withDeflate(raw, plaintext = encode('abc')) {
  const zip = zipSync({ 'manifest.json': plaintext }, { level: 0 }); const m = metadata(zip);
  const data = 30 + m.view.getUint16(26, true) + m.view.getUint16(28, true); const change = raw.length - plaintext.length;
  const result = new Uint8Array(zip.length + change); result.set(zip.subarray(0, data)); result.set(raw, data);
  result.set(zip.subarray(data + plaintext.length), data + raw.length);
  const view = new DataView(result.buffer); const central = m.start + change;
  view.setUint32(result.length - 6, central, true); view.setUint16(8, 8, true); view.setUint16(central + 10, 8, true);
  view.setUint32(18, raw.length, true); view.setUint32(central + 20, raw.length, true); return result;
}

test('ZIP store/deflate and data descriptors round-trip with standard Python zipfile compatibility', async () => {
  const files = sample(); const zip = await packZip(files); assert.deepEqual(await unpackZip(zip), files);
  assert.equal(crc32(encode('123456789')), 0xcbf43926);
  // Windows Python may be a pyenv .bat shim. A fixed fixture path goes through cmd; ZIP bytes use stdin.
  const probe = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'python3',
    process.platform === 'win32' ? ['/d', '/c', 'python', 'tests/fixtures/check_backup_zip.py'] : ['tests/fixtures/check_backup_zip.py'],
    { input: zip, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.error?.message || probe.stderr); assert.deepEqual(Object.keys(JSON.parse(probe.stdout)), [...files.keys()]);
  const simple = zipSync(Object.fromEntries(files), { level: 6 }); assert.deepEqual(await unpackZip(simple), files);
});

test('duplicate paths, traversal, absolute paths, unknown entries, symlinks and encryption flags are rejected', async () => {
  for (const name of ['../manifest.json', '/manifest.json', 'C:/manifest.json', 'drafts\\00000000.json', 'other.json', 'attachments/no-hash.bin']) {
    await assert.rejects(unpackZip(zipSync({ [name]: encode('x') })), fails('invalid-backup-path'));
  }
  const linked = zipSync({ 'manifest.json': [encode('target'), { os: 3, attrs: 0o120777 << 16 }] });
  await assert.rejects(unpackZip(linked), fails('invalid-backup-zip'));
  const zipped = zipSync({ 'manifest.json': encode('one'), 'encrypte.json': encode('two') });
  const m = metadata(zipped); const second = m.entries[1];
  zipped.set(encode('manifest.json'), second.central + 46); zipped.set(encode('manifest.json'), second.local + 30);
  // The second original name is exactly the same length; both local and central now duplicate.
  await assert.rejects(unpackZip(zipped), fails('invalid-backup-zip'));
  const flags = zipSync({ 'manifest.json': encode('x') }); const f = metadata(flags);
  f.view.setUint16(f.entries[0].local + 6, 1, true); f.view.setUint16(f.entries[0].central + 8, 1, true);
  await assert.rejects(unpackZip(flags), fails('invalid-backup-zip'));
});

test('both directories, contiguous ranges, CRC, counts and actual inflated sizes are validated', async () => {
  for (const mutate of [
    (zip, m) => { zip[m.entries[0].local + 30] = 0x78; },
    (zip, m) => { m.view.setUint32(m.entries[0].central + 42, 1, true); },
    (zip, m) => { m.view.setUint32(m.end + 12, 1, true); },
    (zip, m) => { m.view.setUint32(m.entries[0].local + 14, 0, true); m.view.setUint32(m.entries[0].central + 16, 0, true); },
    (zip, m) => { m.view.setUint16(m.end + 8, BACKUP_LIMITS.entries + 1, true); m.view.setUint16(m.end + 10, BACKUP_LIMITS.entries + 1, true); },
    (zip, m) => { m.view.setUint32(m.entries[0].local + 22, 2, true); m.view.setUint32(m.entries[0].central + 24, 2, true); },
    (zip, m) => { m.view.setUint32(m.entries[0].local + 22, 100, true); m.view.setUint32(m.entries[0].central + 24, 100, true); },
  ]) {
    const zip = zipSync({ 'manifest.json': encode('valid contents') }, { level: 6 }); mutate(zip, metadata(zip));
    await assert.rejects(unpackZip(zip));
  }
  const zip = zipSync({ 'manifest.json': encode('valid contents') });
  for (const changed of [zip.slice(0, -1), new Uint8Array([...zip, 0]), new Uint8Array([0, ...zip])]) await assert.rejects(unpackZip(changed));
});

test('declared capacity and a dishonest deflate expansion fail without returning truncated content', async () => {
  const entries = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`attachments/${String(index).repeat(64)}.bin`, encode('x')]));
  const zip = zipSync(entries); const m = metadata(zip);
  for (const entry of m.entries) {
    m.view.setUint32(entry.local + 22, 25 * 1024 * 1024, true); m.view.setUint32(entry.central + 24, 25 * 1024 * 1024, true);
  }
  await assert.rejects(unpackZip(zip), fails('backup-limit'));
  const bomb = zipSync({ 'manifest.json': new Uint8Array(4 * 1024 * 1024) }, { level: 9 }); const b = metadata(bomb);
  b.view.setUint32(b.entries[0].local + 22, 10, true); b.view.setUint32(b.entries[0].central + 24, 10, true);
  await assert.rejects(unpackZip(bomb), fails('invalid-backup-zip'));
});

test('invalid DEFLATE block complements, missing final blocks and trailing compressed junk are rejected', async () => {
  const valid = deflateSync(encode('abc'));
  for (const raw of [new Uint8Array([1, 3, 0, 0, 0, 97, 98, 99]), valid.subarray(0, -1), new Uint8Array([...valid, 1, 2, 3, 4])]) {
    await assert.rejects(unpackZip(withDeflate(raw)), fails('invalid-backup-zip'));
  }
  assert.deepEqual((await unpackZip(withDeflate(new Uint8Array([1, 3, 0, 252, 255, 97, 98, 99])))).get('manifest.json'), encode('abc'));
});

test('raw BOM paths fail and a signature-less descriptor whose CRC equals the signature is valid', async () => {
  const zip = zipSync({ 'manifest.json': encode('abc') }); const m = metadata(zip);
  const bom = new Uint8Array(zip.length + 3); bom.set(zip.subarray(0, 30)); bom.set([0xef, 0xbb, 0xbf], 30); bom.set(zip.subarray(30), 33);
  const view = new DataView(bom.buffer); view.setUint16(26, 'manifest.json'.length + 3, true); view.setUint32(bom.length - 6, m.start + 3, true);
  await assert.rejects(unpackZip(bom), fails('invalid-backup-zip'));
  const content = new Uint8Array([0xac, 0x0a, 0x7a, 0xd5]); assert.equal(crc32(content), 0x08074b50);
  const signed = await packZip(new Map([[attachment, content]])); const metadataSigned = metadata(signed);
  const descriptor = metadataSigned.start - 16; const plain = new Uint8Array(signed.length - 4);
  plain.set(signed.subarray(0, descriptor)); plain.set(signed.subarray(descriptor + 4), descriptor);
  new DataView(plain.buffer).setUint32(plain.length - 6, metadataSigned.start - 4, true);
  assert.deepEqual((await unpackZip(plain)).get(attachment), content);
});

test('large stored entries let an already queued cancellation run before any successful result', async () => {
  const zip = await packZip(new Map([['encryption.json', encode('{}')], ['payload.bin', new Uint8Array(16 * 1024 * 1024)]]));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 0);
  try { await assert.rejects(unpackZip(zip, { signal: controller.signal }), fails('backup-cancelled')); }
  finally { clearTimeout(timer); }
});

test('caller mutations cannot change an asynchronous archive snapshot and cancellation returns no partial result', async () => {
  const files = sample(); const original = files.get('manifest.json').slice(); const pending = packZip(files);
  files.get('manifest.json').fill(0); files.clear(); const zip = await pending;
  assert.deepEqual((await unpackZip(zip)).get('manifest.json'), original);
  const reading = unpackZip(zip); zip.fill(0); assert.deepEqual((await reading).get('manifest.json'), original);
  for (const kind of ['pack', 'unpack']) {
    const controller = new AbortController(); const archive = await packZip(sample());
    const options = { signal: controller.signal, progress: () => controller.abort() };
    await assert.rejects(kind === 'pack' ? packZip(sample(), options) : unpackZip(archive, options), fails('backup-cancelled'));
  }
});

test('encrypted backups use independent salts/nonces, conceal all inner metadata and authenticate password and contents', async () => {
  const files = sample(); const plaintext = await packZip(files); const before = plaintext.slice();
  const first = await encryptBackup(plaintext, password); const second = await encryptBackup(plaintext, password);
  assert.deepEqual(plaintext, before); assert.notDeepEqual(first, second);
  assert.equal(new TextDecoder().decode(first).includes('manifest.json'), false);
  const one = await unpackZip(first); const two = await unpackZip(second);
  assert.deepEqual([...one.keys()], ['encryption.json', 'payload.bin']);
  const header1 = JSON.parse(new TextDecoder().decode(one.get('encryption.json')));
  const header2 = JSON.parse(new TextDecoder().decode(two.get('encryption.json')));
  assert.notEqual(header1.salt, header2.salt); assert.notEqual(header1.nonce, header2.nonce);
  assert.deepEqual(await decryptBackup(one, password), files);
  await assert.rejects(decryptBackup(one, password + 'wrong'), fails('backup-decryption'));
  const changed = new Map(one); changed.set('payload.bin', one.get('payload.bin').slice()); changed.get('payload.bin')[0] ^= 1;
  await assert.rejects(decryptBackup(changed, password), fails('backup-decryption'));
  const nonce = new Map(one); nonce.set('encryption.json', encode(JSON.stringify({ ...header1, nonce: '0'.repeat(24) })));
  await assert.rejects(decryptBackup(nonce, password), fails('backup-decryption'));
});

test('unsupported KDF work factors, nested envelopes, weak export passwords and cancelled encryption fail explicitly', async () => {
  const zip = await packZip(sample());
  await assert.rejects(encryptBackup(zip, 'short'), fails('backup-password'));
  const encrypted = await encryptBackup(zip, password); const entries = await unpackZip(encrypted);
  const header = JSON.parse(new TextDecoder().decode(entries.get('encryption.json')));
  entries.set('encryption.json', encode(JSON.stringify({ ...header, iterations: 999999999 })));
  await assert.rejects(decryptBackup(entries, password), fails('unsupported-backup-encryption'));
  const nested = await encryptBackup(encrypted, password);
  await assert.rejects(decryptBackup(await unpackZip(nested), password), fails('unsupported-backup-encryption'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(encryptBackup(zip, password, { signal: controller.signal }), fails('backup-cancelled'));
});

test('Node Buffer input snapshots are copied and encryption never zeroes caller-owned bytes', async () => {
  const files = sample(); const buffer = Buffer.from('second entry'); files.set('drafts/00000000.json', buffer);
  const pending = packZip(files); buffer.fill(120);
  const zip = await pending; assert.deepEqual((await unpackZip(zip)).get('drafts/00000000.json'), encode('second entry'));
  const encodedZip = Buffer.from(zip); const reading = unpackZip(encodedZip); encodedZip.fill(0);
  assert.deepEqual((await reading).get('drafts/00000000.json'), encode('second entry'));
  const input = Buffer.from(zip); const before = Buffer.from(input); const encrypted = await encryptBackup(input, password);
  assert.deepEqual(input, before);
  const entries = await unpackZip(encrypted); const ciphertext = Buffer.from(entries.get('payload.bin')); entries.set('payload.bin', ciphertext);
  const decrypting = decryptBackup(entries, password); ciphertext.fill(0);
  assert.deepEqual((await decrypting).get('drafts/00000000.json'), encode('second entry'));
});
