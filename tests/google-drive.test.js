import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleDriveFileStore } from '../src/sources/google-drive.js';
import { sha256 } from '../src/sources/files.js';

const encode = value => new TextEncoder().encode(value);
const response = (value, status = 200, headers = {}) => ({ status, headers, body: encode(JSON.stringify(value)) });
const empty = (status, headers = {}) => ({ status, headers, body: new Uint8Array() });
const failCode = code => error => error.code === code;
const location = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private-session';
const metadata = file => ({ id: file.id, size: String(file.size), spaces: ['appDataFolder'], trashed: false,
  sha256Checksum: file.sha256, appProperties: { wfFormat: 'work-fleet-file', wfSchema: '1', wfKind: file.kind, wfSha256: file.sha256 } });
async function fixture(bytes = new Uint8Array([0, 255, 1, 3])) {
  const file = { id: 'allocated-id', kind: 'attachment', size: bytes.length, sha256: await sha256(bytes) };
  return { file, bytes, metadata: metadata(file) };
}
function scripted(steps) {
  const calls = [];
  const request = async input => {
    calls.push(input); const step = steps.shift(); assert.ok(step, `unexpected ${input.method} ${input.path}`);
    return typeof step === 'function' ? step(input) : step;
  };
  return { store: new GoogleDriveFileStore({ accountId: 'verified-subject', request, now: () => Date.UTC(2026, 9, 4) }), calls,
    done: () => assert.equal(steps.length, 0) };
}

test('Drive enumeration, changes and ID allocation use appDataFolder with exact field and token semantics', async () => {
  const f = await fixture();
  const s = scripted([response({ startPageToken: 'start' }), response({ files: [f.metadata], nextPageToken: 'page +/&' }), response({}),
    response({ changes: [{ fileId: f.file.id, file: f.metadata }], nextPageToken: 'next' }),
    response({ changes: [{ fileId: 'deleted-id', removed: true }], newStartPageToken: 'last' }), response({ ids: [f.file.id] })]);
  assert.equal(s.store.sourceId, 'google-drive:verified-subject:appdata-v1');
  assert.equal(await s.store.getStartCursor(), 'start');
  assert.deepEqual(await s.store.listFiles(), { files: [f.file], nextPageToken: 'page +/&', incomplete: false });
  assert.deepEqual(await s.store.listFiles({ pageToken: 'page +/&' }), { files: [], nextPageToken: null, incomplete: false });
  assert.deepEqual(await s.store.listChanges({ cursor: 'start' }), { changes: [{ id: f.file.id, removed: false, file: f.file }], nextCursor: 'next' });
  assert.deepEqual(await s.store.listChanges({ cursor: 'next' }), { changes: [{ id: 'deleted-id', removed: true }], cursor: 'last' });
  assert.equal(await s.store.allocateFileId(), f.file.id); s.done();
  const urls = s.calls.map(call => new URL(call.path, 'https://www.googleapis.com'));
  assert.equal(urls[0].pathname, '/drive/v3/changes/startPageToken');
  assert.equal(urls[0].searchParams.has('spaces'), false);
  assert.equal(urls[1].searchParams.get('spaces'), 'appDataFolder');
  assert.equal(urls[1].searchParams.get('q'), 'trashed = false');
  assert.equal(urls[2].searchParams.get('pageToken'), 'page +/&');
  assert.equal(urls[3].searchParams.get('includeRemoved'), 'true');
  assert.equal(urls[3].searchParams.get('spaces'), 'appDataFolder');
  assert.equal(urls[3].searchParams.has('restrictToMyDrive'), false);
  assert.equal(urls[5].searchParams.get('space'), 'appDataFolder');
  assert.equal(urls[5].searchParams.get('type'), 'files');
  assert.ok(s.calls.every(call => !Object.keys(call.headers).some(key => key.toLowerCase() === 'authorization')));
});

test('Drive rejects unsupported metadata, false integrity claims and ambiguous or malformed pages', async () => {
  const f = await fixture();
  for (const patch of [{ size: '03' }, { size: '-1' }, { size: '999999999999999999999' }, { spaces: ['drive'] },
    { appProperties: {} }, { appProperties: { ...f.metadata.appProperties, wfSchema: '2' } }, { sha256Checksum: '0'.repeat(64) }]) {
    const s = scripted([response({ files: [{ ...f.metadata, ...patch }] })]); await assert.rejects(s.store.listFiles()); s.done();
  }
  for (const page of [{ changes: [{}], newStartPageToken: 'a' }, { changes: [], nextPageToken: 'a', newStartPageToken: 'b' },
    { changes: [{ fileId: 'other-id', file: f.metadata }], newStartPageToken: 'a' }, { changes: [], newStartPageToken: '' }, { changes: {} }]) {
    const s = scripted([response(page)]); await assert.rejects(s.store.listChanges({ cursor: 'old' }));
  }
  const s = scripted([response({ incompleteSearch: true })]); assert.equal((await s.store.listFiles()).incomplete, true);
});

test('media download verifies hash and size, preserves binary data and uses an explicit response limit', async () => {
  const f = await fixture();
  const s = scripted([{ status: 200, headers: {}, body: f.bytes }, { status: 200, headers: {}, body: new Uint8Array([1, 2, 3, 4]) }]);
  assert.deepEqual(await s.store.readFile(f), f.bytes);
  assert.equal(s.calls[0].path, `/drive/v3/files/${f.file.id}?alt=media`);
  assert.equal(s.calls[0].maxResponseBytes, 64 * 1024);
  await assert.rejects(s.store.readFile(f), failCode('file-integrity'));
});

test('resumable creation uses the reserved ID, scoped metadata, binary bytes and server checksum confirmation', async () => {
  const f = await fixture(); const s = scripted([empty(200, { Location: location }), response(f.metadata, 201)]);
  assert.deepEqual(await s.store.createFile(f), f.file); s.done();
  const [start, upload] = s.calls;
  assert.equal(start.method, 'POST'); assert.ok(start.path.startsWith('/upload/drive/v3/files?uploadType=resumable'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(start.body)), {
    id: f.file.id, name: `work-fleet-v1-attachment-${f.file.sha256}.bin`, mimeType: 'application/octet-stream', parents: ['appDataFolder'],
    appProperties: f.metadata.appProperties,
  });
  assert.equal(start.headers['X-Upload-Content-Length'], '4');
  assert.equal(upload.method, 'PUT'); assert.equal(upload.headers['Content-Range'], 'bytes 0-3/4');
  assert.deepEqual(upload.body, f.bytes);
});

test('resuming a partial lost response queries the server and sends only unreceived bytes', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 3); bytes[1024 * 1024] = 255;
  const f = await fixture(bytes); const accepted = 256 * 1024;
  const s = scripted([empty(200, { location }), () => { throw new Error('private network details'); },
    empty(308, { range: `bytes=0-${accepted - 1}` }), response(f.metadata)]);
  await assert.rejects(s.store.createFile(f), failCode('network'));
  assert.deepEqual(await s.store.createFile(f), f.file); s.done();
  assert.equal(s.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(s.calls[2].headers['Content-Range'], `bytes */${bytes.length}`);
  assert.equal(s.calls[2].body.length, 0);
  assert.equal(s.calls[3].headers['Content-Range'], `bytes ${accepted}-${bytes.length - 1}/${bytes.length}`);
  assert.deepEqual(s.calls[3].body, bytes.slice(accepted));
});

test('multi-chunk upload follows acknowledged ranges and can verify completed response loss without resending content', async () => {
  const f = await fixture(new Uint8Array(2 * 1024 * 1024 + 11));
  const s = scripted([empty(200, { location }), empty(308, { range: 'bytes=0-1048575' }), empty(308, { range: 'bytes=0-2097151' }),
    () => { throw new Error('connection lost after server completed'); }, response(f.metadata)]);
  await assert.rejects(s.store.createFile(f), failCode('network'));
  assert.deepEqual(await s.store.createFile(f), f.file); s.done();
  assert.deepEqual(s.calls.slice(1, 4).map(call => call.body.length), [1048576, 1048576, 11]);
  assert.equal(s.calls.at(-1).headers['Content-Range'], `bytes */${f.bytes.length}`);
  assert.equal(s.calls.at(-1).body.length, 0);
});

test('expired upload sessions retry with the same file ID and mismatched checksum replies remain failures', async () => {
  const f = await fixture();
  const s = scripted([empty(200, { location }), empty(404), empty(200, { location }), response({ ...f.metadata, sha256Checksum: '0'.repeat(64) })]);
  await assert.rejects(s.store.createFile(f), failCode('upload-session-expired'));
  await assert.rejects(s.store.createFile(f), failCode('file-integrity'));
  const starts = s.calls.filter(call => call.method === 'POST'); assert.equal(starts.length, 2);
  assert.ok(starts.every(call => JSON.parse(new TextDecoder().decode(call.body)).id === f.file.id));
});

test('every resumable 4xx discards its session while retrying the same durable file ID', async () => {
  const f = await fixture();
  for (const [status, reason] of [[400, 'badRequest'], [403, 'rateLimitExceeded'], [429, 'rateLimitExceeded']]) {
    const s = scripted([empty(200, { location }), response({ error: { errors: [{ reason }] } }, status),
      empty(200, { location: location.replace('private-session', 'replacement') }), response(f.metadata)]);
    await assert.rejects(s.store.createFile(f));
    assert.deepEqual(await s.store.createFile(f), f.file); s.done();
    assert.equal(s.calls[2].method, 'POST');
    assert.equal(JSON.parse(new TextDecoder().decode(s.calls[2].body)).id, f.file.id);
    assert.ok(s.calls[3].path.includes('upload_id=replacement'));
  }
});

test('untrusted Location headers cannot send contents or credentials to a different endpoint', async () => {
  const f = await fixture();
  for (const value of ['https://attacker.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    'http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=x',
    location + '&upload_id=duplicate', location + '&other=extra', location + '#fragment',
    location.replace('https://', 'https://name:secret@'), location.replace('/upload/drive/v3/files', '/other'), 'not a URL']) {
    const s = scripted([empty(200, { location: value })]);
    await assert.rejects(s.store.createFile(f), failCode('invalid-upload-session')); assert.equal(s.calls.length, 1);
  }
});

test('invalid or stalled upload ranges stop instead of skipping bytes or looping forever', async () => {
  const f = await fixture();
  for (const range of ['bytes=0-99', 'bytes=1-2', 'bytes=0-NaN', 'bytes=0-01', 'bytes=0-9007199254740992', null]) {
    const s = scripted([empty(200, { location }), empty(308, range === null ? {} : { range })]);
    await assert.rejects(s.store.createFile(f)); assert.equal(s.calls.length, 2);
  }
});

test('an absent server checksum requires a verified readback; empty attachments use a valid multipart body', async () => {
  const f = await fixture(new Uint8Array()); const withoutChecksum = { ...f.metadata }; delete withoutChecksum.sha256Checksum;
  const s = scripted([response(withoutChecksum), { status: 200, headers: {}, body: f.bytes }]);
  assert.deepEqual(await s.store.createFile(f), f.file); s.done();
  assert.ok(s.calls[0].path.includes('uploadType=multipart'));
  const boundary = s.calls[0].headers['Content-Type'].split('boundary=')[1];
  const body = new TextDecoder().decode(s.calls[0].body);
  assert.ok(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`));
  assert.ok(body.endsWith(`Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`));
  assert.equal(s.calls[1].method, 'GET');
});

test('Drive error classification honors Retry-After and never exposes remote response or transport details', async () => {
  for (const [status, reason, code] of [[401, 'x', 'unauthorized'], [409, 'x', 'file-exists'], [429, 'x', 'rate-limit'],
    [403, 'rateLimitExceeded', 'rate-limit'], [403, 'userRateLimitExceeded', 'rate-limit'], [503, 'x', 'service-unavailable'],
    [403, 'storageQuotaExceeded', 'storage-quota'], [403, 'insufficientPermissions', 'source-permission'], [404, 'x', 'source-file-missing']]) {
    const s = scripted([response({ error: { errors: [{ reason, message: 'PRIVATE DATA' }], message: 'PRIVATE DATA' } }, status, { 'retry-after': '12' })]);
    await assert.rejects(s.store.getStartCursor(), error => error.code === code && error.details.retryAfterMs === 12000 && !error.message.includes('PRIVATE'));
  }
  const s = scripted([empty(410), empty(400), empty(429, { 'retry-after': 'Sun, 04 Oct 2026 00:00:30 GMT' }),
    () => { throw new Error('PRIVATE TOKEN'); }]);
  await assert.rejects(s.store.listChanges({ cursor: 'old' }), failCode('cursor-expired'));
  await assert.rejects(s.store.listFiles({ pageToken: 'old' }), failCode('page-expired'));
  await assert.rejects(s.store.getStartCursor(), error => error.details.retryAfterMs === 30000);
  await assert.rejects(s.store.getStartCursor(), error => error.code === 'network' && !error.message.includes('PRIVATE'));
});

test('oversized and duplicate JSON responses fail before interpretation; aborted transport cannot report success', async () => {
  const s = scripted([{ status: 200, headers: {}, body: new Uint8Array(2 * 1024 * 1024 + 1) },
    { status: 200, headers: {}, body: encode('{"ids":["first"],"ids":["other"]}') }]);
  await assert.rejects(s.store.allocateFileId(), failCode('invalid-source-response'));
  await assert.rejects(s.store.allocateFileId(), failCode('invalid-json'));
  const controller = new AbortController();
  const stop = scripted([() => { controller.abort(); return response({ startPageToken: 'never accepted' }); }]);
  await assert.rejects(stop.store.getStartCursor({ signal: controller.signal }), failCode('stale-session'));
});
