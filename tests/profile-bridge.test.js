import test from 'node:test';
import assert from 'node:assert/strict';
import { profileBridge } from '../src/native/bridge.js';
import { NativeRecordStore } from '../src/storage/records-native.js';

const fakeBridge = () => {
  const calls = [];
  return { calls, request: async (method, params) => { calls.push({ method, params }); return null; }, onEvent: () => () => {}, onCloseRequested: () => () => {} };
};

test('every request through a profile bridge names the profile and keeps its own parameters', async () => {
  const bridge = fakeBridge(); const local = profileBridge(bridge, 'local');
  await local.request('storage.load', { kind: 'workspace' }); await local.request('storage.records.status');
  assert.deepEqual(bridge.calls, [{ method: 'storage.load', params: { kind: 'workspace', profile: 'local' } },
    { method: 'storage.records.status', params: { profile: 'local' } }]);
});

test('a record store on a profile bridge reads that profile and refuses another', async () => {
  const bridge = fakeBridge();
  const store = new NativeRecordStore(profileBridge(bridge, 'local'), { profileId: 'local', maxChunkBytes: 256 * 1024 });
  assert.equal(await store.status('local'), null);
  assert.deepEqual(bridge.calls.at(-1), { method: 'storage.records.status', params: { profile: 'local' } });
  await assert.rejects(store.status('google:someone'), error => error.code === 'invalid-profile');
  store.close?.();
});

test('closing a store on a profile bridge leaves the shared bridge open', () => {
  let closed = false; const bridge = { ...fakeBridge(), close() { closed = true; } };
  profileBridge(bridge, 'local').close();
  assert.equal(closed, false);
});
