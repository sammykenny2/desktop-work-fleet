import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteBatchIds, deleteBatchRequest, deleteBatchResult } from '../src/sources/drive-batch.js';
import { GoogleDriveFileStore } from '../src/sources/google-drive.js';
import { NativeGoogleDatasetStore } from '../src/native/google.js';
import { DatasetReset } from '../src/sources/dataset-reset.js';
import { sha256 } from '../src/sources/files.js';

const encode = value => new TextEncoder().encode(value);
const response = statuses => encode(statuses.map(([index, status]) => `--reply_boundary\r\nContent-Type: application/http\r\nContent-ID: <response-wf-${index}>\r\n\r\nHTTP/1.1 ${status} Result\r\nContent-Type: application/json\r\n\r\n${status === 403 ? '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}' : ''}\r\n`).join('') + '--reply_boundary--\r\n');

test('batch deletion matches every native request fixture and rejects injected, duplicate or excessive IDs', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/dataset/native-wire.json', import.meta.url)));
  assert.equal(new TextDecoder().decode(deleteBatchRequest(fixture.deletion.ids)), fixture.deletion.body);
  for (const ids of fixture.badDeletionIds) assert.throws(() => deleteBatchIds(ids));
});

test('batch replies correlate out-of-order results and retain failures without losing successful deletions', () => {
  assert.deepEqual(deleteBatchResult(['one', 'two', 'three', 'four'], response([[3, 503], [1, 404], [2, 403], [0, 204]])),
    [{ id: 'one', code: null }, { id: 'two', code: null }, { id: 'three', code: 'rate-limit' }, { id: 'four', code: 'service-unavailable' }]);
  for (const body of [response([[0, 204]]), response([[0, 204], [0, 204]]), response([[0, 204], [3, 204]]),
    response([[0, 204], [1, 204]]).slice(0, -10), encode('not a multipart reply')]) {
    assert.throws(() => deleteBatchResult(['one', 'two'], body), { code: 'invalid-source-response' });
  }
});

test('Drive sends one HTTP batch for 100 IDs, including unknown old content', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `old-${index}`); let calls = 0;
  const store = new GoogleDriveFileStore({ accountId: 'test', request: async input => {
    calls++; assert.equal(input.path, '/batch/drive/v3'); assert.equal(input.method, 'POST');
    assert.deepEqual(input.body, deleteBatchRequest(ids));
    return { status: 200, headers: {}, body: response(ids.map((id, index) => [index, 204])) };
  } });
  assert.ok((await store.deleteFiles({ ids })).every(item => item.code === null)); assert.equal(calls, 1);
});

test('native deletion uses the bounded transfer and discards it after validating partial results', async () => {
  const bytes = response([[1, 429], [0, 204]]), digest = await sha256(bytes), methods = [];
  const store = new NativeGoogleDatasetStore({ request: async (method, args) => {
    methods.push(method);
    if (method === 'google.deleteBatch') {
      assert.deepEqual(args, { accountId: 'test', fileIds: ['one', 'two'] });
      return { token: 'reply', size: bytes.length, sha256: digest };
    }
    if (method === 'transfer.read') return { offset: 0, done: true, base64: Buffer.from(bytes).toString('base64') };
    assert.equal(method, 'transfer.discard'); return {};
  } }, { profileId: 'google:test' }, 'test');
  assert.deepEqual(await store.deleteFiles({ ids: ['one', 'two'] }), [{ id: 'one', code: null }, { id: 'two', code: 'rate-limit' }]);
  assert.deepEqual(methods, ['google.deleteBatch', 'transfer.read', 'transfer.discard']);
});

test('both reset discovery adapters accept incompatible descriptor metadata while ordinary sync rejects it', async () => {
  const corrupt = { id: 'old-dataset', mimeType: 'application/octet-stream', appProperties: {
    wfFormat: 'work-fleet-dataset', wfKind: 'dataset', wfSchema: 'unknown' } };
  for (const native of [false, true]) {
    const store = native ? new NativeGoogleDatasetStore({ request: async (method, args) => {
      assert.equal(method, 'google.dataset.list'); return { files: args.query.scope === 'fences' ? [] : [corrupt] };
    } }, { profileId: 'google:test' }, 'test') : new GoogleDriveFileStore({ accountId: 'test', request: async input => {
      assert.equal(input.method, 'GET'); assert.ok(!input.path.includes('alt=media'));
      const fence = new URL(input.path, 'https://www.googleapis.com').searchParams.get('q').includes("value='reset'");
      return { status: 200, headers: {}, body: encode(JSON.stringify({ files: fence ? [] : [corrupt] })) };
    } });
    assert.deepEqual((await new DatasetReset(store, {}).preview()).datasets, ['old-dataset']);
    await assert.rejects(store.listObjects({ query: { scope: 'datasets' } }), { code: 'invalid-dataset' });
  }
});
