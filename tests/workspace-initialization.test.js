import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { FileSync, resetSource } from '../src/sources/file-sync.js';
import { encodeRevision, revisionRecord } from '../src/sources/revisions.js';
import { encodeSourceRevision } from '../src/sources/source-revisions.js';
import { INITIAL_GROUP_NAME, initialGroupRecord } from '../src/sources/initial-group.js';
import { encodeInitialization, initializationId, initializationReceipt, prepareInitialization } from '../src/sources/workspace-initialization.js';
import { sha256 } from '../src/sources/files.js';
import { gate, MemoryAttachmentStorage, MemoryFileStore } from './fixtures/file-store.js';
import { t } from '../src/i18n/index.js';

const code = expected => error => error.code === expected;
const group = (id = 'g') => revisionRecord('group', { id, revision: `${id}-root`, name: INITIAL_GROUP_NAME, deleted: false });
async function client(store) {
  let disk; let failure = () => false;
  const persist = async (next, previous) => {
    if (failure(next)) throw new FleetError('disk-full', 'disk full');
    assert.equal(previous, disk?.revision ?? null); disk = copy(next);
  };
  let workspace = await Workspace.create({ profileId: 'google:fixture', deviceId: crypto.randomUUID(),
    area: { x: 0, y: 0, width: 1200, height: 800 }, bootstrapGroup: false, persist });
  const storage = new MemoryAttachmentStorage(); let sync;
  const connect = () => { sync = new FileSync({ workspace, storage, fileStore: store, bootstrapGroup: true }); };
  connect();
  return { get workspace() { return workspace; }, get sync() { return sync; }, disk: () => copy(disk), storage,
    fail: fn => { failure = fn; }, reopen: () => { workspace = new Workspace(disk, persist); connect(); } };
}
const seedControl = (store, value) => store.seed(encodeInitialization(value), 'workspace');

test('reset followers wait through marker-only cleanup, then download the owner initialization without uploading', async () => {
  const store = new MemoryFileStore(); store.pageSize = 1;
  await store.seed(encodeRevision(group('old-unscoped')));
  let job; const saved = value => { job = copy(value); };
  store.hooks.deleteFile = () => { throw new FleetError('cleanup-interrupted', 'stop'); };
  await assert.rejects(resetSource(store, { saveJob: saved }), code('cleanup-interrupted'));
  const follower = await client(store); const creates = store.calls.filter(call => call.method === 'createFile').length;
  assert.equal((await follower.sync.sync()).phase, 'waiting-initialization');
  assert.deepEqual(follower.workspace.snapshot.groups, []); assert.equal(follower.disk().sync.lastSuccessfulSyncAt, undefined);
  assert.equal(store.calls.filter(call => call.method === 'createFile').length, creates);
  follower.reopen(); assert.equal((await follower.sync.sync()).phase, 'waiting-initialization');
  delete store.hooks.deleteFile; await resetSource(store, { job, saveJob: saved });
  const completed = store.calls.filter(call => call.method === 'createFile').length;
  await follower.sync.sync(); assert.equal(follower.workspace.snapshot.groups.length, 1);
  assert.equal(follower.workspace.snapshot.groups[0].id, (await initialGroupRecord(store.sourceId, [job.marker.id])).entityId);
  assert.equal(store.calls.filter(call => call.method === 'createFile').length, completed);
});

test('a fresh account can finish another device prepare after its creator disappears', async () => {
  const store = new MemoryFileStore(); const plan = await prepareInitialization(store.sourceId, []);
  await seedControl(store, plan); const c = await client(store); await c.sync.sync();
  assert.equal(c.workspace.syncState.initialization.activePlan, await initializationId(plan));
  assert.equal(c.workspace.snapshot.groups.length, 1);
});

test('a fresh waiting follower forgets old controls cleared during a later reset, including after cursor expiry and restart', async () => {
  for (const expire of [false, true]) {
    const store = new MemoryFileStore(); store.pageSize = 1; await resetSource(store);
    const old = await client(store); await old.sync.sync();
    const entered = gate(); const resume = gate();
    store.hooks.deleteFile = async () => { delete store.hooks.deleteFile; entered.resolve(); await resume.promise; };
    const running = resetSource(store); await entered.promise;
    const follower = await client(store); assert.equal((await follower.sync.sync()).phase, 'waiting-initialization');
    assert.deepEqual(follower.workspace.snapshot.groups, []);
    resume.resolve(); await running; follower.reopen();
    if (expire) store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
    await follower.sync.sync(); assert.equal(follower.sync.status.phase, 'idle');
    assert.equal(follower.workspace.snapshot.groups.length, 1); assert.equal(follower.workspace.syncState.sourceResetIds.length, 1);
    await assert.rejects(old.sync.sync(), code('source-reset'));
  }
});

test('a manual same-name group created while prepare is uploading survives and cannot stall the chosen starter', async () => {
  const store = new MemoryFileStore(); const c = await client(store); const entered = gate(); const resume = gate();
  store.hooks.createFile = async ({ file }) => { if (file.kind === 'workspace') { delete store.hooks.createFile; entered.resolve(); await resume.promise; } };
  const running = c.sync.sync(); await entered.promise;
  const manual = await c.workspace.createGroup(INITIAL_GROUP_NAME); resume.resolve(); await running;
  await c.sync.sync(); assert.equal(c.sync.status.phase, 'idle');
  assert.equal(c.workspace.snapshot.groups.length, 2); assert.ok(c.workspace.snapshot.groups.some(g => g.id === manual.id));
  const fresh = await client(store); await fresh.sync.sync(); assert.deepEqual(fresh.workspace.snapshot.groups, c.workspace.snapshot.groups);
});

test('ready is only a receipt: missing required bytes and attachments keep the whole graph staged until restart can verify them', async () => {
  const store = new MemoryFileStore(); store.pageSize = 1;
  const bytes = new Uint8Array([1, 2, 3]); const digest = await sha256(bytes); const root = group();
  const card = revisionRecord('card', { id: 'c', revision: 'c-root', groupId: 'g', deleted: false, archived: false, completed: false,
    content: { format: 'markdown', text: 'keep', attachments: [{ id: digest, name: 'file.bin' }] } });
  const plan = await prepareInitialization(store.sourceId, [], { mode: 'restore', origin: 'reset', records: [root, card], attachments: [digest] });
  await seedControl(store, await initializationReceipt(plan)); await seedControl(store, plan);
  await store.seed(encodeSourceRevision(root, []));
  const c = await client(store); assert.equal((await c.sync.sync()).phase, 'waiting-initialization'); assert.deepEqual(c.workspace.snapshot.groups, []);
  await store.seed(encodeSourceRevision(card, [])); assert.equal((await c.sync.sync()).phase, 'waiting-initialization');
  assert.deepEqual(c.workspace.snapshot.cards, []); assert.equal(c.workspace.state.revisions.length, 0);
  c.reopen(); await store.seed(bytes, 'attachment'); await c.sync.sync();
  assert.equal(c.workspace.snapshot.cards[0].content.text, 'keep'); assert.equal(c.workspace.state.revisions.length, 2);
  assert.ok(await c.storage.getAttachment('google:fixture', digest));
});

test('activation and graph publication commit together; a disk failure reopens staged bytes without publishing a partial workspace', async () => {
  const store = new MemoryFileStore(); const plan = await prepareInitialization(store.sourceId, [], { mode: 'restore', origin: 'reset', records: [group()] });
  await seedControl(store, plan); await store.seed(encodeSourceRevision(group(), [])); await seedControl(store, await initializationReceipt(plan));
  const c = await client(store); c.fail(state => Boolean(state.sync.initialization?.activePlan));
  await assert.rejects(c.sync.sync(), code('disk-full')); assert.deepEqual(c.workspace.snapshot.groups, []);
  assert.equal(c.disk().sync.initialization.activePlan, null);
  c.fail(() => false); c.reopen(); await c.sync.sync(); assert.equal(c.workspace.snapshot.groups.length, 1);
});

test('a crash after saving ready but before its rescan still fetches earlier skipped data after reopening', async () => {
  const store = new MemoryFileStore();
  const plan = await prepareInitialization(store.sourceId, [], { mode: 'restore', origin: 'reset', records: [group()] });
  await seedControl(store, plan); await store.seed(encodeSourceRevision(group(), []));
  const c = await client(store); assert.equal((await c.sync.sync()).phase, 'waiting-initialization');
  await seedControl(store, await initializationReceipt(plan));
  c.fail(state => Boolean(Object.keys(state.sync.initialization?.receipts || {}).length && state.sync.cursor === null));
  await assert.rejects(c.sync.sync(), code('disk-full'));
  assert.equal(c.disk().sync.cursor, '3'); assert.equal(c.disk().sync.initialization.refreshNeeded, true);
  c.fail(() => false); c.reopen(); await c.sync.sync();
  assert.equal(c.workspace.snapshot.groups.length, 1); assert.equal(c.disk().sync.initialization.refreshNeeded, false);
});

test('after a current plan is known, missing required or control files remain integrity errors even if activation failed', async () => {
  for (const kind of ['revision', 'workspace']) {
    const store = new MemoryFileStore(); await resetSource(store);
    const c = await client(store); c.fail(state => Boolean(state.sync.initialization?.activePlan));
    await assert.rejects(c.sync.sync(), code('disk-full'));
    const removed = [...store.files.values()].find(entry => entry.file.kind === kind).file;
    await store.deleteFile({ id: removed.id }); c.fail(() => false); c.reopen();
    await assert.rejects(c.sync.sync(), code('source-file-missing'));
    assert.deepEqual(c.workspace.snapshot.groups, []); assert.equal(c.disk().sync.initialization.activePlan, null);
  }
});

test('conflicting plans and wrong required content stop without publishing staged groups', async () => {
  for (const conflict of [true, false]) {
    const store = new MemoryFileStore(); const plan = await prepareInitialization(store.sourceId, [], { mode: 'restore', origin: 'reset', records: [group()] });
    await seedControl(store, plan); await seedControl(store, await initializationReceipt(plan));
    if (conflict) await seedControl(store, await prepareInitialization(store.sourceId, [], { mode: 'existing' }));
    await store.seed(encodeSourceRevision({ ...group(), value: { ...group().value, name: 'different bytes' } }, []));
    const c = await client(store); await assert.rejects(c.sync.sync(), code(conflict ? 'initialization-conflict' : 'invalid-initialization'));
    assert.deepEqual(c.workspace.snapshot.groups, []); assert.equal(c.disk().sync.initialization.activePlan, null);
  }
});

test('a fresh computer signing in puts the groups that initialization releases on the arrival layer', async () => {
  const store = new MemoryFileStore(); const plan = await prepareInitialization(store.sourceId, [], { mode: 'existing' });
  await store.seed(encodeRevision(group('manual')));
  await seedControl(store, plan); await seedControl(store, await initializationReceipt(plan));
  const c = await client(store); c.workspace.setArrivalLayer(() => 'wallpaper'); await c.sync.sync();
  assert.equal(c.workspace.syncState.initialization.activePlan, await initializationId(plan));
  assert.deepEqual(c.workspace.snapshot.groups.map(g => g.id), ['manual']);
  assert.deepEqual(c.workspace.layout.state.groupLayers, { manual: 'wallpaper' });
  assert.deepEqual(c.disk().layout, c.workspace.layout.state);
});

test('an initialized empty workspace remains empty and an existing same-name group is adopted by identity', async () => {
  for (const existing of [true, false]) {
    const store = new MemoryFileStore(); const plan = await prepareInitialization(store.sourceId, [], { mode: 'existing' });
    if (existing) await store.seed(encodeRevision(group('manual')));
    await seedControl(store, plan); await seedControl(store, await initializationReceipt(plan));
    const c = await client(store); await c.sync.sync(); c.reopen(); await c.sync.sync();
    assert.deepEqual(c.workspace.snapshot.groups.map(g => g.id), existing ? ['manual'] : []);
    assert.equal(store.calls.filter(call => call.method === 'createFile').length, 0);
  }
});

test('a reset journal survives lost create replies and reopening never repeats cleanup once initialization starts', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(group('old'))); let job;
  const saveJob = value => { job = copy(value); };
  store.hooks.afterCreate = ({ file }) => { if (file.kind === 'workspace') throw new FleetError('lost-reply', 'lost'); };
  await assert.rejects(resetSource(store, { saveJob }), code('lost-reply'));
  assert.equal(job.phase, 'initialize'); const marker = job.marker.id;
  const deletes = store.calls.filter(call => call.method === 'deleteFile').length;
  const reserved = Object.values(job.uploads)[0].id;
  delete store.hooks.afterCreate;
  const result = await resetSource(store, { job, saveJob });
  assert.equal(result.job.phase, 'complete'); assert.equal(job.marker.id, marker);
  assert.equal(store.calls.filter(call => call.method === 'deleteFile').length, deletes);
  assert.ok(store.files.has(reserved)); assert.equal(store.files.size, 4);
});

test('an older reset journal cannot recreate its marker or delete data after a later reset has completed', async () => {
  const store = new MemoryFileStore(); let old;
  await resetSource(store, { saveJob: value => { old = copy(value); } });
  await resetSource(store); const files = [...store.files.keys()]; const calls = store.calls.length;
  await assert.rejects(resetSource(store, { job: old }), code('source-reset-superseded'));
  assert.deepEqual([...store.files.keys()], files);
  assert.equal(store.calls.slice(calls).some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
});

test('incomplete listings during initial or resumed cleanup never authorize deletion or ready', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(group('old')));
  const original = store.listFileIds.bind(store); let incomplete = true;
  store.listFileIds = async input => ({ ...await original(input), incomplete });
  await assert.rejects(resetSource(store), code('incomplete-source-scan'));
  assert.equal(store.calls.some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
  incomplete = false; let job;
  store.hooks.deleteFile = () => { throw new FleetError('interrupted', 'stop'); };
  await assert.rejects(resetSource(store, { saveJob: value => { job = value; } }), code('interrupted'));
  const count = store.calls.length; incomplete = true; delete store.hooks.deleteFile;
  await assert.rejects(resetSource(store, { job }), code('incomplete-source-scan'));
  assert.equal(store.calls.slice(count).some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
});

test('a malformed restore manifest or account-mismatched reset journal fails before remote deletion', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(group('old')));
  await assert.rejects(resetSource(store, { initialization: { mode: 'restore', attachments: ['invalid'] } }), code('invalid-initialization'));
  assert.equal(store.calls.some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
  let job; await resetSource(store, { saveJob: value => { job = value; } });
  const count = store.calls.length; store.sourceId = 'another-account';
  await assert.rejects(resetSource(store, { job }), code('invalid-reset-job'));
  assert.equal(store.calls.slice(count).some(call => ['createFile', 'deleteFile'].includes(call.method)), false);
});

test('a reset save acknowledgement loss reloads the durable journal, and superseded jobs expose the local-copy recovery route', async () => {
  const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
  const reset = source.slice(source.indexOf('async function resetWorkspace('), source.indexOf('function currentDesktopEditor()'));
  for (const errorCode of ['lost-save', 'source-reset-superseded']) {
    let loaded = { revision: 4, sourceReset: { sourceId: 'fixture' } }; let reloads = 0;
    const context = vm.createContext({ accountBusy: false, nativeClosing: false, clearInterval() {}, syncTimer: null,
      stopAutomatic: null, automatic: null, syncService: null, desktop: null, activeActions: [], draftPending: null,
      currentDraft: null, unsavedDrafts: new Set(), document: { body: {} }, profileId: 'google:fixture',
      native: { bridge: {}, info: {} }, googleAccount: { accountId: 'fixture' }, workspace: { state: {}, saveSourceReset() {} },
      requireConnected() {}, NativeGoogleFileStore: class {}, t,
      resetSource: async () => { throw Object.assign(new Error(errorCode), { code: errorCode }); },
      storage: { load: async () => copy(loaded), save: async value => { loaded = value; } },
      location: { reload: () => { reloads++; } }, initializeGoogle: () => assert.fail('must not restart the old writer'),
    });
    await vm.runInContext(`${reset}\nresetWorkspace(() => {})`, context);
    assert.equal(reloads, 1); assert.equal(Boolean(loaded.sourceReset.superseded), errorCode === 'source-reset-superseded');
  }
});
