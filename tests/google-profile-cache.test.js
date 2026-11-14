import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleProfileCache } from '../src/app/google-profile.js';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { createBackup } from '../src/backup/payload.js';
import { unpackZip } from '../src/backup/archive.js';

const identity = { name: 'Synthetic Cached Person', photo: { type: 'image/png',
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') } };
async function fixture() {
  const records = new MemoryRecordStore(); const profileId = 'google:fixture';
  const storage = new WorkspaceRecordStorage(records, profileId);
  const workspace = await Workspace.create({ profileId, deviceId: 'device', current: true, history: storage,
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
  const changed = [];
  const cache = new GoogleProfileCache({ accountId: 'fixture', storage, current: () => true,
    changed: value => changed.push(value), request: async () => ({ ...identity, token: 'not-a-real-token', photoUrl: 'https://example.test/unused' }) });
  return { records, profileId, storage, workspace, changed, cache };
}

test('profile metadata survives reopening only its account and changes no notes, pending uploads or current-state backup contents', async () => {
  const f = await fixture();
  const state = await f.storage.load(f.profileId); const pending = await f.storage.pendingPage();
  await f.cache.refresh();
  assert.deepEqual(await f.storage.load(f.profileId), state);
  assert.deepEqual(await f.storage.pendingPage(), pending);
  const cached = await f.storage.getControl('google-profile');
  assert.deepEqual(Object.keys(cached).sort(), ['accountId', 'name', 'photo', 'updatedAt']);
  assert.deepEqual(cached.photo, identity.photo);

  const reopened = new WorkspaceRecordStorage(f.records, f.profileId); const shown = [];
  await reopened.load(f.profileId);
  await new GoogleProfileCache({ accountId: 'fixture', storage: reopened, current: () => true,
    changed: value => shown.push(value), request: () => assert.fail('restoration must work offline') }).restore();
  assert.deepEqual(shown, [identity]);
  for (const profileId of ['local', 'google:other']) {
    assert.equal(await new WorkspaceRecordStorage(f.records, profileId).getControl('google-profile'), null);
  }
  const files = await unpackZip((await createBackup({ workspace: f.workspace, storage: f.storage, coverage: 'current-state-only' })).bytes);
  for (const [name, bytes] of files) {
    const text = new TextDecoder().decode(bytes);
    assert.ok(!text.includes(identity.name) && !text.includes(identity.photo.data) && !text.includes('google-profile'), name);
  }
});

test('saving optional profile metadata alongside a note preserves the writer revision fences', async () => {
  const f = await fixture(); const pending = f.workspace.pendingCount;
  const [, note] = await Promise.all([f.cache.refresh(),
    f.workspace.createCard({ text: 'A synthetic note saved during refresh', format: 'markdown', attachments: [] })]);
  assert.equal(f.workspace.pendingCount, pending + 1);
  assert.equal((await f.storage.load(f.profileId)).cards.find(card => card.id === note.id).content.text, note.content.text);
  assert.equal((await f.storage.getControl('google-profile')).name, identity.name);
});
