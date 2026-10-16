import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { schemas, requireSchemaVersion, migrateSchema, validateMigration } from '../src/core/schema.js';
import { migrateWorkspace } from '../src/core/workspace-schema.js';
import { Workspace } from '../src/core/workspace.js';
import { canonicalJson } from '../src/sources/json.js';
import { FileSync } from '../src/sources/file-sync.js';
import { MemoryFileStore } from './fixtures/file-store.js';
import { createBackup, openBackup } from '../src/backup/payload.js';
import { packZip, unpackZip } from '../src/backup/archive.js';
import { prepareRestore } from '../src/backup/restore.js';
import { validateAutomaticState } from '../src/backup/automatic.js';
import { NativeStorage } from '../src/storage/native.js';
import { resumeCloudRestore } from '../src/backup/cloud-restore.js';

const historical = JSON.parse(await readFile(new URL('./fixtures/workspace-v1.json', import.meta.url), 'utf8'));
const copy = structuredClone;
const fails = code => error => error.code === code;
const area = { x: 0, y: 0, width: 1000, height: 800 };

test('all format versions are independent; missing, malformed and future versions are rejected', () => {
  assert.equal(schemas.workspace, 2);
  for (const kind of Object.keys(schemas)) {
    assert.equal(requireSchemaVersion({ schemaVersion: schemas[kind] }, kind), schemas[kind]);
    for (const schemaVersion of [undefined, null, true, '1', 0, -1, 1.5, schemas[kind] + 1]) {
      assert.throws(() => requireSchemaVersion({ schemaVersion }, kind), fails('unsupported-schema'));
    }
  }
  assert.throws(() => validateAutomaticState({ schemaVersion: 2 }, 'local'), fails('unsupported-backup-journal'));
});

test('sequential migrations support skipped app releases and validate every destination without mutating input', () => {
  const input = { schemaVersion: 1, profileId: 'local', revision: 7, custom: { keep: true } }; const original = copy(input); const checked = [];
  const options = { kind: 'test', current: 3, steps: { 1: state => ({ ...state, first: true }), 2: state => ({ ...state, second: true }) },
    validate: (state, version) => { checked.push(version); assert.equal(state.schemaVersion, version); } };
  const result = migrateSchema(input, options);
  assert.deepEqual(checked, [2, 3]); assert.deepEqual(input, original); assert.equal(result.state.schemaVersion, 3);
  assert.deepEqual(result.state.custom, original.custom); assert.equal(result.state.revision, 7);
  const again = migrateSchema(result.state, options); assert.equal(again.changed, false); assert.deepEqual(again.state, result.state);
  assert.throws(() => migrateSchema(input, { ...options, steps: { 1: options.steps[1] } }), fails('missing-migration'));
  assert.throws(() => migrateSchema(input, { ...options, steps: { 1: state => ({ ...state, profileId: 'other' }) } }), fails('invalid-migration'));
  assert.throws(() => migrateSchema(input, { ...options, validate: () => { throw new Error('bad destination'); } }), /bad destination/);
  assert.deepEqual(input, original);
});

test('historical v1 full outbox, private draft, extensions and paper layers migrate without changing immutable records', () => {
  const original = copy(historical); const { state } = migrateWorkspace(original);
  assert.equal(state.schemaVersion, 2); assert.deepEqual(original, historical);
  assert.deepEqual(state.outbox, historical.outbox); assert.deepEqual(state.drafts, historical.drafts);
  assert.deepEqual(state.extension, historical.extension);
  assert.equal(state.layout.groupLayers[historical.groups[0].id], 'floating');
  assert.equal('residentLayer' in state.layout.placements[historical.cards[0].id], false);
  for (const record of state.revisions) {
    const operation = historical.outbox.find(item => item.operationId === record.revisionId);
    assert.equal(canonicalJson(record.value), canonicalJson(operation.value)); assert.deepEqual(record.parents, operation.parents);
  }
  assert.deepEqual(migrateWorkspace(state).state, state);
  const broken = copy(historical); broken.outbox = [];
  assert.throws(() => migrateWorkspace(broken), fails('incomplete-local-history')); assert.deepEqual(original, historical);
});

test('production open waits for the durable migration; failed commit leaves v1 untouched and retry upgrades once', async () => {
  let disk = copy(historical); let recovery; let fail = true; let writes = 0; let published = false;
  const persist = async () => { throw new Error('ordinary save must not perform migration'); };
  const migrate = async (state, expected, fromVersion) => {
    assert.equal(disk.revision, expected); validateMigration(disk, state, fromVersion);
    if (fail) throw new Error('disk full');
    assert.equal(recovery, undefined); recovery = copy(disk); disk = copy(state); writes++;
  };
  await assert.rejects(Workspace.open(disk, persist, migrate).then(() => { published = true; }), /disk full/);
  assert.equal(published, false); assert.equal(recovery, undefined); assert.deepEqual(disk, historical);
  fail = false;
  const opened = await Workspace.open(disk, persist, migrate);
  assert.equal(opened.state.schemaVersion, 2); assert.equal(opened.state.revision, historical.revision + 1);
  assert.deepEqual(recovery, historical); assert.deepEqual(disk, opened.state);
  const reopened = await Workspace.open(disk, persist, migrate); assert.deepEqual(reopened.state, opened.state); assert.equal(writes, 1);
});

test('invalid or newer workspaces and hosts without migration support cannot publish or save an upgrade', async () => {
  let writes = 0; const persist = async () => { writes++; };
  for (const schemaVersion of [undefined, 0, 3, '1']) {
    await assert.rejects(Workspace.open({ ...historical, schemaVersion }, persist, persist), fails('unsupported-schema'));
  }
  await assert.rejects(Workspace.open(historical, persist), fails('migration-unavailable')); assert.equal(writes, 0);
  const storage = new NativeStorage({ request: () => { throw new Error('bridge must not be used'); } }, { profileId: 'local', capabilities: {} });
  assert.throws(() => storage.migrate(migrateWorkspace(historical).state, historical.revision, 1), fails('migration-unavailable'));
  await assert.rejects(new Workspace(historical, persist).createGroup('blocked'), fails('migration-required'));
});

test('invalid destination layout, drafts and outbox are rejected before any migration commit', async () => {
  for (const corrupt of [
    state => { state.layout.grid.rows = 4; },
    state => { state.layout.placements[state.cards[0].id].width = -1; },
    state => { state.layout.shortcuts = { 'Ctrl+1': 'missing-group' }; },
    state => { Object.values(state.drafts)[0].cardId = ''; },
    state => { state.outbox[0].entityId = 'wrong-entity'; },
    state => { state.sync = { sourceId: null, sessionId: null, cursor: 4 }; },
  ]) {
    const state = copy(historical); corrupt(state); const original = copy(state); let commits = 0;
    await assert.rejects(Workspace.open(state, async () => {}, async () => { commits++; }));
    assert.equal(commits, 0); assert.deepEqual(state, original);
  }
});

test('accumulated sync ledgers beyond the single-record JSON node limit remain readable without losing entries', () => {
  const state = copy(historical); state.sync = { sourceId: 'source', sessionId: null, cursor: 'cursor', files: {} };
  for (let index = 0; index < 45000; index++) state.sync.files[`file-${index}`] = { id: `file-${index}`, kind: 'revision', sha256: 'a'.repeat(64), size: 42 };
  const opened = new Workspace(state, async () => {});
  assert.equal(Object.keys(opened.state.sync.files).length, 45000); assert.deepEqual(opened.state.sync.files['file-44999'], state.sync.files['file-44999']);
});

test('early partial drafts retain their content and absent membership/baseline instead of inventing edit ancestry', async () => {
  const state = copy(historical); const draft = Object.values(state.drafts)[0]; delete draft.groupId; delete draft.baseRevision;
  draft.recoveredFrom = [{ id: 'early-baseline', baseline: canonicalJson({ ...draft, id: 'early-baseline' }) }];
  const original = copy(draft);
  const opened = await Workspace.open(state, async () => {}, async () => {});
  assert.deepEqual(opened.state.drafts[draft.id], original);
  await assert.rejects(opened.commitDraft(draft.id), fails('missing-group'));
  assert.deepEqual(opened.state.drafts[draft.id], original);
});

test('an unfinished cloud overwrite upgrades its old durable job before any remote deletion or upload', async () => {
  const fileStore = new MemoryFileStore(); const state = { ...copy(historical), profileId: 'google:test',
    cloudRestore: { sourceId: fileStore.sourceId, phase: 'reset', fingerprint: 'fixture' } };
  const storage = { save: async () => { throw new Error('ordinary save must not run'); }, migrate: async () => { throw new Error('migration disk full'); } };
  await assert.rejects(resumeCloudRestore({ state, storage, fileStore }), /migration disk full/);
  assert.equal(fileStore.calls.length, 0);
});

test('a future cloud revision stops the failed page before pushing local operations; cursor and local records survive retries', async () => {
  let disk; const storage = { putAttachmentBytes: async () => {}, getAttachment: async () => null };
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId: 'test-device', area, persist: async state => { disk = copy(state); } });
  const original = workspace.state; const store = new MemoryFileStore({ pageSize: 100 });
  const record = { ...original.revisions[0], schemaVersion: 2 };
  await store.seed(new TextEncoder().encode(JSON.stringify(record)));
  const sync = new FileSync({ workspace, storage, fileStore: store });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(sync.sync(), fails('unsupported-revision-format'));
    assert.deepEqual(disk.revisions, original.revisions); assert.deepEqual(disk.outbox, original.outbox); assert.equal(disk.sync.cursor, null);
    assert.equal(store.calls.some(item => item.method === 'createFile'), false);
  }
  await sync.stop();
});

test('migrated workspaces export v1 ZIPs for both local and Google restore; future ZIP version is detected before restore', async () => {
  const workspace = new Workspace(historical, async () => {}); const storage = { getAttachment: async () => null };
  const { bytes, manifest } = await createBackup({ workspace, storage }); assert.equal(manifest.schemaVersion, 1);
  const document = await openBackup(bytes);
  for (const profileId of ['local', 'google:other']) {
    const target = await Workspace.create({ profileId, deviceId: 'target', area, persist: async () => {} });
    const plan = await prepareRestore({ workspace: target, document, mode: 'merge', workAreas: [area] });
    await target.applyRestore(plan, { persist: async () => {} });
    assert.equal(target.state.schemaVersion, 2); assert.equal(target.state.profileId, profileId);
    assert.deepEqual(target.snapshot.cards[0].content, historical.cards[0].content);
  }
  const files = await unpackZip(bytes); const future = JSON.parse(new TextDecoder().decode(files.get('manifest.json'))); future.schemaVersion = 2;
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(future)));
  await assert.rejects(openBackup(await packZip(files)), fails('unsupported-backup-schema'));
});
