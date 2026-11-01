import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datasetQuery, googleDatasetDescriptor, validateDatasetFile } from '../src/sources/dataset-codec.js';
import { NativeGoogleDatasetStore } from '../src/native/google.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/dataset/native-wire.json', import.meta.url), 'utf8'));
test('the shared dataset wire fixture defines identical closed descriptors and typed query behavior', () => {
  for (const { input, expected } of fixture.queries) assert.equal(datasetQuery(input), expected);
  for (const { input, metadata } of fixture.files) { assert.deepEqual(validateDatasetFile(input), input); assert.deepEqual(googleDatasetDescriptor(metadata), input); }
  for (const input of fixture.badQueries) assert.throws(() => datasetQuery(input));
  for (const input of fixture.badFiles) assert.throws(() => validateDatasetFile(input));
  const { metadata } = fixture.files[0];
  assert.throws(() => googleDatasetDescriptor({ ...metadata, spaces: 'appDataFolder' }));
  assert.throws(() => googleDatasetDescriptor({ ...metadata, trashed: 'false' }));
});

test('native dataset RPCs pass typed selectors and verify metadata instead of exposing HTTP or credentials', async () => {
  const sent = [], revision = fixture.files.find(item => item.input.kind === 'revision'), folder = fixture.files.find(item => item.input.kind === 'folder');
  const replies = [{ files: [revision.metadata], incompleteSearch: false }, folder.metadata, folder.metadata,
    { changes: [{ fileId: revision.input.id, file: revision.metadata }, { fileId: 'old-fence', file: { appProperties: { wfKind: 'reset' } } }], newStartPageToken: 'end' }];
  const store = new NativeGoogleDatasetStore({ request: async (method, args) => { sent.push({ method, args }); return replies.shift(); } }, { profileId: 'google:account' }, 'account');
  const query = fixture.queries.find(item => item.input.scope === 'history').input;
  assert.deepEqual((await store.listObjects({ query })).files, [revision.input]);
  assert.deepEqual(await store.createFolder({ file: folder.input }), folder.input);
  assert.deepEqual(await store.getObject({ id: folder.input.id }), folder.input);
  const changes = await store.listDatasetChanges({ cursor: 'start' });
  assert.equal(changes.changes[1].legacyReset, true);
  assert.deepEqual(sent.map(item => item.method), ['google.dataset.list', 'google.dataset.folder', 'google.dataset.get', 'google.dataset.changes']);
  assert.deepEqual(sent[0].args, { accountId: 'account', query, pageToken: null });
  assert.ok(sent.every(item => !('url' in item.args) && !('q' in item.args) && !('headers' in item.args)));
  const count = sent.length;
  await assert.rejects(store.getObject({ id: 'line\n' }));
  await assert.rejects(store.listObjects({ query: { scope: 'legacy', q: 'arbitrary' } }));
  assert.equal(sent.length, count);
});

test('native root descriptors require direct-parent proof before the app-data alias is normalized', async () => {
  const root = fixture.files.find(item => item.input.kind === 'dataset-root');
  const metadata = { ...root.metadata, parents: ['real-app-data-id'] }; let calls = 0;
  const store = new NativeGoogleDatasetStore({ request: async method => {
    calls++; return method === 'google.dataset.get' ? metadata : { files: [metadata] };
  } }, { profileId: 'google:account' }, 'account');
  assert.deepEqual(await store.getObject({ id: root.input.id }), root.input); assert.equal(calls, 2);
});
