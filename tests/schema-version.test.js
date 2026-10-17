import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schemas, requireSchemaVersion } from '../src/core/schema.js';
import { Workspace } from '../src/core/workspace.js';
import { FileSync } from '../src/sources/file-sync.js';
import { MemoryFileStore } from './fixtures/file-store.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { packZip, unpackZip } from '../src/backup/archive.js';
import { prepareRestore } from '../src/backup/restore.js';
import { validateAutomaticState } from '../src/backup/automatic.js';

const area = { x: 0, y: 0, width: 1000, height: 800 };
const fixture = JSON.parse(await readFile(new URL('./fixtures/workspace-v1.json', import.meta.url), 'utf8'));
const fails = code => error => error.code === code;

test('all current data formats stay V1 and reject unsupported version labels', () => {
  for (const kind of Object.keys(schemas)) {
    assert.equal(schemas[kind], 1); assert.equal(requireSchemaVersion({ schemaVersion: 1 }, kind), 1);
    for (const schemaVersion of [undefined, null, true, '1', 0, -1, 1.5, 2]) {
      assert.throws(() => requireSchemaVersion({ schemaVersion }, kind), fails('unsupported-schema'));
    }
  }
  assert.throws(() => validateAutomaticState({ schemaVersion: 2 }, 'local'), fails('unsupported-backup-journal'));
});

test('loading V1 is read-only and ordinary edits stay V1 with one normal commit per operation', async () => {
  let writes = 0; const original = structuredClone(fixture);
  const workspace = new Workspace(fixture, async state => { writes++; assert.equal(state.schemaVersion, 1); });
  assert.equal(writes, 0); assert.deepEqual(fixture, original);
  assert.deepEqual(workspace.state.drafts, fixture.drafts); assert.deepEqual(workspace.state.extension, fixture.extension);
  await workspace.createCard({ format: 'markdown', text: 'Edit V1 directly', extra: { keep: true } }, fixture.groups[0].id);
  assert.equal(writes, 1); assert.equal(workspace.state.schemaVersion, 1);
  const fresh = await Workspace.create({ profileId: 'local', deviceId: 'fresh-device', area, persist: async () => {} });
  assert.equal(fresh.state.schemaVersion, 1);
  assert.throws(() => new Workspace({ ...fixture, schemaVersion: 2 }), fails('unsupported-schema'));
});

test('unsupported cloud data preserves the current cursor and outbox instead of uploading local edits', async () => {
  let disk; const storage = { putAttachmentBytes: async () => {}, getAttachment: async () => null };
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId: 'device', area,
    persist: async state => { disk = structuredClone(state); } });
  const original = workspace.state; const fileStore = new MemoryFileStore();
  await fileStore.seed(new TextEncoder().encode(JSON.stringify({ ...original.revisions[0], schemaVersion: 2 })));
  const sync = new FileSync({ workspace, storage, fileStore });
  await assert.rejects(sync.sync(), fails('unsupported-revision-format'));
  assert.deepEqual(disk.revisions, original.revisions); assert.deepEqual(disk.outbox, original.outbox); assert.equal(disk.sync.cursor, null);
  assert.equal(fileStore.calls.some(call => call.method === 'createFile'), false); await sync.stop();
});

test('local and Google backup round trips keep both workspace and ZIP at V1', async () => {
  const workspace = new Workspace(fixture, async () => {});
  const { bytes, manifest } = await createBackup({ workspace, storage: { getAttachment: async () => null } });
  assert.equal(manifest.schemaVersion, 1); const document = await openBackup(bytes);
  for (const profileId of ['local', 'google:other']) {
    const target = await Workspace.create({ profileId, deviceId: 'target', area, persist: async () => {} });
    const plan = await prepareRestore({ workspace: target, document, mode: 'merge', workAreas: [area] });
    await target.applyRestore(plan, { persist: async () => {} });
    assert.equal(target.state.schemaVersion, 1); assert.equal(target.state.profileId, profileId);
    assert.deepEqual(target.snapshot.cards[0].content, fixture.cards[0].content);
  }
  const files = await unpackZip(bytes); const invalid = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))); invalid.schemaVersion = 2;
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(invalid)));
  await assert.rejects(openBackup(await packZip(files)), fails('unsupported-backup-schema'));
});
