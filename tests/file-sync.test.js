import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { FileSync, resetSource } from '../src/sources/file-sync.js';
import { sha256, validateFile, verifyFile } from '../src/sources/files.js';
import { encodeRevision, revisionRecord } from '../src/sources/revisions.js';
import { decodeSourceRevision, encodeSourceRevision } from '../src/sources/source-revisions.js';
import { gate, MemoryAttachmentStorage, MemoryFileStore } from './fixtures/file-store.js';

const area = { x: 0, y: 0, width: 1400, height: 900 };
const text = value => ({ format: 'markdown', text: value });
const failCode = code => error => error.code === code;
const groupRecord = (id = 'g', revision = 'g-root') => revisionRecord('group', { id, revision, name: id, deleted: false });

async function client(fileStore, { bootstrapGroup = false, initializeGroup = false, profileId = 'account-a' } = {}) {
  let disk; let fail = () => false;
  const persist = async (state, revision) => {
    if (fail(state)) throw new Error('disk full');
    assert.equal(disk?.revision ?? null, revision); disk = copy(state);
  };
  let workspace = await Workspace.create({ profileId, deviceId: crypto.randomUUID(), bootstrapGroup, area, persist });
  const storage = new MemoryAttachmentStorage();
  const connect = () => new FileSync({ workspace, storage, fileStore, bootstrapGroup: initializeGroup, now: () => 1000, random: () => 0 });
  let sync = connect();
  return { get workspace() { return workspace; }, get sync() { return sync; }, storage, disk: () => copy(disk),
    fail: callback => { fail = callback; },
    reopen: (saved = disk) => { disk = copy(saved); workspace = new Workspace(disk, persist); sync = connect(); },
  };
}

// Hold every writer at createFile so all six have already observed the same empty source.
async function initializeSix(store) {
  const clients = await Promise.all(Array.from({ length: 6 }, () => client(store, { initializeGroup: true })));
  const ready = gate(); let writers = 0;
  store.hooks.createFile = async () => { if (++writers === clients.length) ready.resolve(); await ready.promise; };
  try { await Promise.all(clients.map(c => c.sync.sync())); }
  finally { delete store.hooks.createFile; }
  assert.equal(writers, 6, 'the fixture forces all six devices to initialize concurrently');
  await Promise.all(clients.map(c => c.sync.sync()));
  const group = clients[0].workspace.snapshot.groups[0];
  assert.ok(group, 'an empty account gets its initial group');
  for (const c of clients) {
    assert.deepEqual(c.workspace.snapshot.groups, [group]);
    assert.equal(c.workspace.state.revisions.length, 1);
    assert.deepEqual(c.workspace.state.conflicts, []);
    assert.deepEqual(c.workspace.pendingOperations, []);
  }
  const roots = [...store.files.values()].filter(entry => entry.file.kind === 'revision').map(entry => decodeSourceRevision(entry.bytes).record);
  assert.ok(roots.every(record => record.revisionId === group.revision && record.entityId === group.id));
  return clients;
}

test('six simultaneous first syncs converge on one initial group and one root revision, including after restart', async () => {
  const store = new MemoryFileStore(); const clients = await initializeSix(store);
  const group = clients[0].workspace.snapshot.groups[0];
  const late = await client(store, { initializeGroup: true }); await late.sync.sync();
  assert.deepEqual(late.workspace.snapshot.groups, [group]);
  for (const c of clients) c.reopen();
  await Promise.all(clients.map(c => c.sync.sync()));
  for (const c of clients) assert.deepEqual(c.workspace.snapshot.groups, [group]);
  assert.equal(store.calls.filter(call => call.method === 'createFile').length, 6);
});

test('six cleared copies converge after each cloud reset, while old copies stop and each reset gets a new initial identity', async () => {
  const store = new MemoryFileStore(); let clients = await initializeSix(store);
  for (let reset = 0; reset < 2; reset++) {
    const before = clients[0].workspace.snapshot;
    await resetSource(store, { wait: async () => {} });
    for (const c of clients) {
      await assert.rejects(c.sync.sync(), failCode('source-reset'));
      assert.deepEqual(c.workspace.snapshot, before);
    }
    clients = await initializeSix(store);
    const group = clients[0].workspace.snapshot.groups[0];
    assert.notEqual(group.id, before.groups[0].id); assert.notEqual(group.revision, before.groups[0].revision);
    assert.equal(clients[0].workspace.snapshot.cards.length, 0);
    for (const c of clients) c.reopen();
    await Promise.all(clients.map(c => c.sync.sync()));
    for (const c of clients) assert.deepEqual(c.workspace.snapshot.groups, [group]);
  }
});

test('an initial upload arriving after a completed reset cannot add an old-generation group', async () => {
  const store = new MemoryFileStore(); const entered = gate(); const resume = gate();
  const old = await client(store, { initializeGroup: true });
  store.hooks.createFile = async ({ file }) => {
    if (file.kind !== 'revision') return;
    delete store.hooks.createFile; entered.resolve(); await resume.promise;
  };
  const running = old.sync.sync(); await entered.promise;
  await resetSource(store, { wait: async () => {} });
  const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
  const initial = fresh.workspace.snapshot.groups[0];
  const stopped = assert.rejects(running, failCode('source-reset'));
  resume.resolve(); await stopped; await fresh.sync.sync();
  store.pageSize = 1; store.files = new Map([...store.files].reverse());
  const late = await client(store, { initializeGroup: true }); await late.sync.sync();
  for (const c of [fresh, late]) {
    assert.deepEqual(c.workspace.snapshot.groups, [initial]);
    assert.equal(c.workspace.state.revisions.length, 1); assert.deepEqual(c.workspace.state.conflicts, []);
  }
});

test('a fresh scan defers a stale automatic root until the reset marker on its last page, then creates the current root', async () => {
  const store = new MemoryFileStore(); const entered = gate(); const resume = gate();
  const old = await client(store, { initializeGroup: true });
  store.hooks.createFile = async ({ file }) => {
    if (file.kind !== 'revision') return;
    delete store.hooks.createFile; entered.resolve(); await resume.promise;
  };
  const running = old.sync.sync(); await entered.promise;
  await resetSource(store, { wait: async () => {} });
  const oldGroup = old.workspace.snapshot.groups[0];
  const stopped = assert.rejects(running, failCode('source-reset')); resume.resolve(); await stopped;
  store.pageSize = 1; store.files = new Map([...store.files].reverse());
  const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
  assert.equal(fresh.workspace.snapshot.groups.length, 1);
  assert.notEqual(fresh.workspace.snapshot.groups[0].id, oldGroup.id);
  assert.equal(fresh.workspace.state.revisions.length, 1); assert.deepEqual(fresh.workspace.state.conflicts, []);
});

test('late pre-reset edits, retirements and notes stay in the old device copy and cannot alter the new workspace', async () => {
  for (const action of ['rename', 'retire', 'card']) {
    const store = new MemoryFileStore(); const old = await client(store, { initializeGroup: true }); await old.sync.sync();
    const group = old.workspace.snapshot.groups[0];
    if (action === 'rename') await old.workspace.renameGroup(group.id, '重設前的名稱', group.revision);
    else if (action === 'card') await old.workspace.createCard(text('重設前的在途便箋'), group.id);
    else {
      const target = await old.workspace.createGroup('舊接收組'); await old.sync.sync();
      await old.workspace.mergeGroup(old.workspace.previewGroupMerge(group.id, target.id));
    }
    const revision = old.workspace.pendingOperations[0].operationId;
    const entered = gate(); const resume = gate();
    store.hooks.createFile = async ({ file }) => {
      if (file.kind !== 'revision') return;
      delete store.hooks.createFile; entered.resolve(); await resume.promise;
    };
    const running = old.sync.sync(); await entered.promise;
    await resetSource(store, { wait: async () => {} });
    const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
    const initial = fresh.workspace.snapshot.groups[0];
    const stopped = assert.rejects(running, failCode('source-reset')); resume.resolve(); await stopped;
    await fresh.sync.sync();
    assert.deepEqual(fresh.workspace.snapshot.groups, [initial]); assert.equal(initial.name, '我的便箋');
    assert.ok(old.workspace.state.revisions.some(record => record.revisionId === revision), 'the old device retains its edits');
    assert.equal(fresh.workspace.state.revisions.some(record => record.revisionId === revision), false);
    assert.deepEqual(fresh.workspace.state.conflicts, []);
    assert.deepEqual(fresh.workspace.snapshot.cards, []);
  }
});

test('initial group identity is account scoped and existing same-name groups and their notes stay intact', async () => {
  const a = new MemoryFileStore(); const b = new MemoryFileStore(); b.sourceId = 'drive:account-b:app-data';
  const ca = await client(a, { initializeGroup: true }); const cb = await client(b, { initializeGroup: true, profileId: 'account-b' });
  await Promise.all([ca.sync.sync(), cb.sync.sync()]);
  assert.notEqual(ca.workspace.snapshot.groups[0].id, cb.workspace.snapshot.groups[0].id);
  for (let i = 0; i < 5; i++) await ca.workspace.createGroup('我的便箋');
  for (const group of ca.workspace.snapshot.groups) await ca.workspace.createCard(text(group.id), group.id);
  await ca.sync.sync();
  const before = ca.workspace.snapshot;
  const late = await client(a, { initializeGroup: true }); await late.sync.sync();
  assert.deepEqual(new Set(late.workspace.snapshot.groups.map(group => JSON.stringify(group))), new Set(before.groups.map(group => JSON.stringify(group))));
  assert.deepEqual(late.workspace.snapshot.cards, before.cards);
  assert.deepEqual(late.workspace.state.conflicts, []);
  assert.equal(late.workspace.snapshot.groups.length, 6); assert.equal(late.workspace.snapshot.cards.length, 6);
});

test('existing unscoped V1 groups and unknown extension data remain readable after a reset', async () => {
  for (const mode of ['extension', 'remapped']) {
    const store = new MemoryFileStore(); const old = await client(store, { initializeGroup: true }); await old.sync.sync();
    const group = old.workspace.snapshot.groups[0]; await resetSource(store, { wait: async () => {} });
    if (mode === 'extension') group.annotation = { text: '使用者的額外資料' };
    else { group.id = crypto.randomUUID(); group.revision = crypto.randomUUID(); }
    await store.seed(encodeRevision(revisionRecord('group', group)));
    const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
    assert.deepEqual(fresh.workspace.snapshot.groups, [group]);
    assert.equal(fresh.workspace.state.revisions.length, 1);
  }
});

test('malformed source generation or envelope extensions preserve the cursor and existing workspace', async () => {
  for (const patch of [{ sourceResetIds: null }, { sourceResetIds: ['bad/id'] }, { sourceResetIds: ['same', 'same'] }, { unknown: true }]) {
    const store = new MemoryFileStore(); const c = await client(store); await c.sync.sync();
    const before = c.workspace.state;
    const record = JSON.parse(new TextDecoder().decode(encodeSourceRevision(groupRecord(), [])));
    await store.seed(new TextEncoder().encode(JSON.stringify({ ...record, ...patch })));
    await assert.rejects(c.sync.sync()); assert.deepEqual(c.workspace.state, before);
  }
});

test('a reserved unscoped V1 upload keeps its original bytes and file ID after reopening', async () => {
  const store = new MemoryFileStore(); const original = await client(store, { bootstrapGroup: true });
  let disk = original.disk(); const record = disk.revisions[0]; const bytes = encodeRevision(record);
  const file = await store.seed(bytes, 'revision', 'reserved-v1');
  disk.sync.sourceId = store.sourceId;
  disk.sync.uploads = { [`revision:${record.revisionId}`]: { file, complete: false } };
  const workspace = new Workspace(disk, async (state, revision) => { assert.equal(disk.revision, revision); disk = copy(state); });
  await new FileSync({ workspace, storage: original.storage, fileStore: store }).sync();
  assert.equal(store.files.size, 1); assert.deepEqual(workspace.pendingOperations, []);
  assert.equal(store.calls.filter(call => call.method === 'createFile').at(-1).file.id, file.id);
  assert.deepEqual(workspace.snapshot.groups, original.workspace.snapshot.groups);
});

test('incomplete pulls and pending group history never authorize a new initial group', async () => {
  for (const mode of ['scan', 'changes', 'pending']) {
    const store = new MemoryFileStore();
    if (mode === 'scan') store.listFiles = async () => ({ files: [], incomplete: true });
    if (mode === 'changes') store.listChanges = async () => { throw new FleetError('network', 'offline'); };
    if (mode === 'pending') {
      const record = groupRecord(); record.parents = ['missing-parent']; await store.seed(encodeRevision(record));
    }
    const c = await client(store, { initializeGroup: true });
    if (mode === 'pending') await c.sync.sync(); else await assert.rejects(c.sync.sync());
    assert.deepEqual(c.workspace.snapshot.groups, []);
    assert.deepEqual(c.workspace.pendingOperations, []);
    assert.equal(store.calls.some(call => call.method === 'createFile'), false);
  }
});

test('initial group persistence failure sends nothing, and a lost upload response retries the same root after restart', async () => {
  const store = new MemoryFileStore(); const c = await client(store, { initializeGroup: true });
  c.fail(state => state.revisions.length > 0);
  await assert.rejects(c.sync.sync(), /disk full/);
  assert.deepEqual(c.workspace.snapshot.groups, []);
  assert.equal(store.calls.some(call => call.method === 'createFile'), false);
  c.fail(() => false); c.reopen();
  store.hooks.afterCreate = () => { delete store.hooks.afterCreate; throw new FleetError('network', 'response lost'); };
  await assert.rejects(c.sync.sync(), failCode('network'));
  const group = c.workspace.snapshot.groups[0]; const reserved = Object.values(c.disk().sync.uploads)[0].file.id;
  c.reopen(); await c.sync.sync();
  assert.deepEqual(c.workspace.snapshot.groups, [group]);
  assert.equal(c.workspace.state.revisions.length, 1); assert.equal(store.files.size, 1);
  assert.equal(store.calls.filter(call => call.method === 'createFile').at(-1).file.id, reserved);
  assert.deepEqual(c.workspace.pendingOperations, []);
});

test('a reset stops an initial root before file allocation or reservation, including after reopening and cursor expiry', async () => {
  for (const mode of ['incremental', 'rescan', 'unscoped-incremental', 'unscoped-rescan']) {
    const store = new MemoryFileStore(); const c = await client(store, { initializeGroup: true });
    store.hooks.allocateFileId = () => { throw new FleetError('network', 'allocation failed'); };
    await assert.rejects(c.sync.sync(), failCode('network'));
    assert.deepEqual(c.workspace.syncState.sourceResetIds, []);
    assert.deepEqual(Object.values(c.workspace.syncState.uploads || {}), []);
    const before = c.workspace.snapshot; const saved = c.disk();
    if (mode.startsWith('unscoped')) delete saved.sync.sourceResetIds;
    c.reopen(saved); delete store.hooks.allocateFileId;
    await resetSource(store, { wait: async () => {} });
    if (mode.endsWith('rescan')) store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
    await assert.rejects(c.sync.sync({ force: true }), failCode('source-reset'));
    assert.deepEqual(c.workspace.snapshot, before);
    assert.equal(store.calls.some(call => call.method === 'createFile' && call.file.kind === 'revision'), false);
    const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
    assert.equal(fresh.workspace.snapshot.groups.length, 1);
  }
});

test('a cursor rescan stops at a new reset marker even before any old source file has been deleted', async () => {
  for (const withGeneration of [true, false]) {
    const store = new MemoryFileStore(); const c = await client(store, { initializeGroup: true }); await c.sync.sync();
    if (!withGeneration) { const saved = c.disk(); delete saved.sync.sourceResetIds; c.reopen(saved); }
    await c.workspace.createGroup('重設前尚未上傳的舊群組'); const before = c.workspace.snapshot;
    const entered = gate(); const resume = gate();
    store.hooks.deleteFile = async () => { delete store.hooks.deleteFile; entered.resolve(); await resume.promise; };
    const resetting = resetSource(store, { wait: async () => {} }); await entered.promise;
    store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
    try {
      await assert.rejects(c.sync.sync(), failCode('source-reset'));
      assert.deepEqual(c.workspace.snapshot, before);
      assert.equal(store.calls.filter(call => call.method === 'createFile' && call.file.kind === 'revision').length, 1);
    } finally { resume.resolve(); await resetting; }
    const fresh = await client(store, { initializeGroup: true }); await fresh.sync.sync();
    assert.equal(fresh.workspace.snapshot.groups.length, 1);
  }
});

test('two independent devices exchange paged history and keep both offline branches without sharing layout or drafts', async () => {
  const store = new MemoryFileStore(); store.pageSize = 1;
  const a = await client(store, { bootstrapGroup: true }); const group = a.workspace.snapshot.groups[0];
  const card = await a.workspace.createCard(text('base'), group.id);
  await a.workspace.layout.placeNew(a.workspace.snapshot, [area]); const layoutA = a.workspace.layout.state;
  const draft = a.workspace.blankDraft(group.id, card); draft.content.text = 'private draft'; await a.workspace.saveDraft(draft);
  await a.sync.sync(); assert.equal(a.workspace.pendingOperations.length, 0);
  const b = await client(store); await b.sync.sync();
  assert.equal(b.workspace.snapshot.groups.length, 1, 'a new account profile does not add a second starter group');
  assert.equal(b.workspace.snapshot.cards[0].content.text, 'base');
  assert.deepEqual(b.workspace.state.drafts, {}); assert.deepEqual(b.workspace.layout.state.placements, {});
  const local = await a.workspace.updateCard(card.id, { content: text('A offline') }, card.revision);
  await b.workspace.updateCard(card.id, { content: text('B offline'), deleted: true }, card.revision);
  await b.sync.sync(); await a.sync.sync(); await b.sync.sync();
  for (const c of [a, b]) {
    assert.equal(c.workspace.revisionHeads('card', card.id).length, 2);
    assert.ok(c.workspace.state.conflicts.some(item => item.kind === 'revision'));
    assert.equal(c.workspace.pendingOperations.length, 0);
    assert.equal(c.workspace.state.revisions.length, 4);
  }
  assert.deepEqual(a.workspace.layout.state.placements, layoutA.placements);
  assert.equal(a.workspace.state.drafts[draft.id].content.text, 'private draft');
  const heads = a.workspace.revisionHeads('card', card.id).map(item => item.revisionId);
  await a.workspace.resolveRevisions({ kind: 'card', entityId: card.id, heads, selectedRevision: local.revision });
  await a.sync.sync(); await b.sync.sync();
  assert.equal(b.workspace.revisionHeads('card', card.id).length, 1);
  assert.equal(b.workspace.snapshot.cards[0].content.text, 'A offline');
  assert.equal(store.files.size, 5); assert.equal(b.workspace.state.revisions.length, 5);
});

test('lost success response survives process restart, reuses the durable file ID and verifies 409 bytes before acknowledging', async () => {
  const store = new MemoryFileStore(); const c = await client(store, { bootstrapGroup: true });
  store.hooks.afterCreate = () => { delete store.hooks.afterCreate; throw new FleetError('network', 'response lost'); };
  await assert.rejects(c.sync.sync(), failCode('network'));
  assert.equal(store.files.size, 1); assert.equal(c.workspace.pendingOperations.length, 1);
  const [operation, upload] = Object.entries(c.disk().sync.uploads)[0]; assert.equal(upload.complete, false);
  c.reopen(); await c.sync.sync();
  const creates = store.calls.filter(item => item.method === 'createFile');
  assert.equal(creates.length, 2); assert.equal(creates[0].file.id, creates[1].file.id);
  assert.equal(store.calls.filter(item => item.method === 'allocateFileId').length, 1);
  assert.equal(store.files.size, 1); assert.equal(c.workspace.pendingOperations.length, 0);
  assert.equal(c.disk().sync.uploads[operation].complete, true);
  assert.equal(c.workspace.state.revisions.length, 1, 'ack does not delete local history');
  assert.ok(store.calls.slice(store.calls.lastIndexOf(creates[1]) + 1).some(item => item.method === 'readFile'));
});

test('reservation must reach durable storage before any upload and acknowledgement storage failures remain retryable', async () => {
  const store = new MemoryFileStore(); const c = await client(store, { bootstrapGroup: true });
  c.fail(state => Object.keys(state.sync.uploads || {}).length > 0);
  await assert.rejects(c.sync.sync(), /disk full/);
  assert.equal(store.files.size, 0); assert.equal(store.calls.some(item => item.method === 'createFile'), false);
  c.fail(state => Object.values(state.sync.uploads || {}).some(item => item.complete));
  await assert.rejects(c.sync.sync(), /disk full/);
  assert.equal(store.files.size, 1); assert.equal(c.workspace.pendingOperations.length, 1);
  const reserved = Object.values(c.disk().sync.uploads)[0].file.id;
  c.fail(() => false); c.reopen(); await c.sync.sync();
  assert.equal(store.files.size, 1); assert.equal(c.workspace.pendingOperations.length, 0);
  assert.equal(store.calls.filter(item => item.method === 'createFile').at(-1).file.id, reserved);
});

test('a duplicate ID containing different bytes never clears the operation', async () => {
  const store = new MemoryFileStore(); const c = await client(store, { bootstrapGroup: true });
  store.hooks.createFile = ({ file }) => {
    store.files.set(file.id, { file, bytes: new TextEncoder().encode('wrong content') });
  };
  await assert.rejects(c.sync.sync(), failCode('file-integrity'));
  assert.equal(c.workspace.pendingOperations.length, 1);
  assert.equal(Object.values(c.disk().sync.uploads)[0].complete, false);
});

test('attachments are uploaded before referencing revisions, verified on download and isolated by profile', async () => {
  const store = new MemoryFileStore(); const a = await client(store, { bootstrapGroup: true });
  const bytes = new TextEncoder().encode('<svg onload="alert(1)">raw binary\0</svg>'); const id = await sha256(bytes);
  await a.storage.putAttachmentBytes('account-a', id, bytes);
  await a.workspace.createCard({ ...text('attachment'), attachments: [{ id, name: 'unsafe.svg', mediaType: 'image/svg+xml', size: bytes.length }] },
    a.workspace.snapshot.groups[0].id);
  await a.sync.sync(); const uploaded = store.calls.filter(call => call.method === 'createFile');
  assert.deepEqual(uploaded.map(item => item.file.kind), ['revision', 'attachment', 'revision']);
  const b = await client(store); await b.sync.sync();
  assert.deepEqual(new Uint8Array(await (await b.storage.getAttachment('account-a', id)).arrayBuffer()), bytes);
  assert.equal((await b.storage.getAttachment('account-a', id)).type, 'application/octet-stream');
  assert.equal(await b.storage.getAttachment('account-b', id), null);
  assert.equal(b.workspace.snapshot.cards[0].content.attachments[0].name, 'unsafe.svg');
});

test('missing or damaged local attachments keep the referencing revision queued without uploading it', async () => {
  for (const damaged of [false, true]) {
    const store = new MemoryFileStore(); const c = await client(store, { bootstrapGroup: true });
    const id = await sha256(new Uint8Array([1, 2, 3]));
    const card = await c.workspace.createCard({ ...text('keep me'), attachments: [{ id, name: 'data' }] }, c.workspace.snapshot.groups[0].id);
    if (damaged) c.storage.entries.set(`account-a:${id}`, new Blob(['wrong']));
    await assert.rejects(c.sync.sync(), failCode(damaged ? 'attachment-integrity' : 'missing-attachment'));
    assert.deepEqual(c.workspace.pendingOperations.map(item => item.entityId), [card.id]);
    assert.equal(store.files.size, 1);
    assert.equal(c.workspace.snapshot.cards[0].content.text, 'keep me');
  }
});

test('a full-scan crash keeps the cursor unset and replays persisted pages safely on restart', async () => {
  const store = new MemoryFileStore(); store.pageSize = 1;
  await store.seed(encodeRevision(groupRecord('first', 'first-root')));
  await store.seed(encodeRevision(groupRecord('second', 'second-root')));
  store.hooks.listFiles = ({ pageToken }) => { if (pageToken === '1') throw new FleetError('network', 'page disconnected'); };
  const c = await client(store); await assert.rejects(c.sync.sync(), failCode('network'));
  assert.equal(c.disk().sync.cursor, null); assert.equal(c.workspace.state.revisions.length, 1);
  delete store.hooks.listFiles; c.reopen(); await c.sync.sync();
  assert.equal(c.disk().sync.cursor, '2'); assert.equal(c.workspace.state.revisions.length, 2);
  assert.deepEqual(store.calls.filter(item => item.method === 'listFiles').map(item => item.pageToken), [null, '1', null, '1']);
});

test('changes between the initial cursor and enumeration are replayed even if absent from the listing', async () => {
  const store = new MemoryFileStore(); const record = groupRecord('during-scan', 'new-root');
  store.hooks.getStartCursor = async () => { delete store.hooks.getStartCursor; await store.seed(encodeRevision(record)); };
  store.listFiles = async () => ({ files: [] });
  const c = await client(store); await c.sync.sync();
  assert.equal(c.workspace.snapshot.groups[0].id, 'during-scan'); assert.equal(c.disk().sync.cursor, '1');
});

test('incremental page data and cursor commit together, with earlier pages retained after a later disk failure', async () => {
  const store = new MemoryFileStore(); store.pageSize = 1; const c = await client(store); await c.sync.sync();
  await store.seed(encodeRevision(groupRecord('first', 'first-root')));
  await store.seed(encodeRevision(groupRecord('second', 'second-root')));
  c.fail(state => state.sync.cursor === '2');
  await assert.rejects(c.sync.sync(), /disk full/);
  assert.equal(c.disk().sync.cursor, '1'); assert.deepEqual(c.workspace.snapshot.groups.map(item => item.id), ['first']);
  assert.equal(Object.keys(c.disk().sync.files).length, 1);
  c.fail(() => false); c.reopen(); await c.sync.sync();
  assert.equal(c.disk().sync.cursor, '2'); assert.equal(c.workspace.state.revisions.length, 2);
});

test('invalid JSON, future schemas and changed immutable metadata preserve the last cursor and existing content', async () => {
  for (const mode of ['json', 'schema', 'bytes', 'metadata']) {
    const store = new MemoryFileStore(); const file = await store.seed(encodeRevision(groupRecord()));
    const c = await client(store); await c.sync.sync(); const before = c.workspace.state;
    if (mode === 'metadata') {
      await store.seed(encodeRevision(groupRecord('changed', 'changed-root')), 'revision', file.id);
    } else if (mode === 'bytes') {
      store.files.get(file.id).bytes[0] = 0;
      store.changes.push({ id: file.id, removed: false, file });
    } else {
      await store.seed(new TextEncoder().encode(mode === 'json' ? '{broken' : JSON.stringify({ ...groupRecord('x', 'x-root'), schemaVersion: 99 })));
    }
    await assert.rejects(c.sync.sync());
    assert.deepEqual(c.workspace.state, before, mode);
    assert.equal(c.sync.status.phase, 'needs-attention');
  }
});

test('cloud reset: the marker stops devices holding old files, while fresh devices start from the cleared source', async () => {
  const store = new MemoryFileStore();
  const a = await client(store, { bootstrapGroup: true }); await a.workspace.createCard(text('重設前'), a.workspace.snapshot.groups[0].id);
  await a.sync.sync(); const b = await client(store); await b.sync.sync(); const before = b.workspace.snapshot;
  const progress = []; const result = await resetSource(store, { progress: (done, total) => progress.push([done, total]), wait: async () => {} });
  assert.deepEqual([...store.files.keys()], [result.marker.id]); assert.equal(result.marker.kind, 'reset');
  assert.deepEqual(progress.at(-1), [result.deleted, result.deleted]); assert.equal(result.deleted, 2);
  await assert.rejects(b.sync.sync(), failCode('source-reset'));
  assert.deepEqual(b.workspace.snapshot, before, 'the reset never deletes this device copy by itself');
  for (const fresh of [await client(store), await client(store, { profileId: 'account-a' })]) {
    await fresh.sync.sync();
    assert.equal(fresh.workspace.snapshot.cards.length, 0);
    assert.deepEqual(Object.values(fresh.workspace.syncState.files || {}), [result.marker], 'the reset generation survives restart');
  }
  const restarted = await client(store, { bootstrapGroup: true }); await restarted.sync.sync();
  await restarted.workspace.createCard(text('重設後'), restarted.workspace.snapshot.groups[0].id); await restarted.sync.sync();
  const later = await client(store); await later.sync.sync();
  assert.deepEqual(later.workspace.snapshot.cards.map(card => card.content.text), ['重設後']);
  await later.sync.sync();
});

test('cloud reset is recognised after a cursor restart, and removals of files never received are harmless', async () => {
  const store = new MemoryFileStore(); const a = await client(store, { bootstrapGroup: true }); await a.sync.sync();
  const b = await client(store); await b.sync.sync();
  await resetSource(store, { wait: async () => {} });
  store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
  await assert.rejects(b.sync.sync(), failCode('source-reset'));
  const c = await client(store); await c.sync.sync();
  store.changes.push({ id: 'never-received', removed: true }); await c.sync.sync();
});

test('cloud reset retries rate limits and deletes files uploaded while it ran', async () => {
  const store = new MemoryFileStore(); const a = await client(store, { bootstrapGroup: true }); await a.sync.sync();
  let limited = false; let uploaded = false; const waits = [];
  store.hooks.deleteFile = () => { if (!limited) { limited = true; throw new FleetError('rate-limit', 'slow down'); } };
  store.hooks.listFileIds = async (input, fixture) => {
    if (!uploaded && fixture.calls.some(call => call.method === 'deleteFile')) { uploaded = true; await fixture.seed(encodeRevision(groupRecord('late'))); }
  };
  const result = await resetSource(store, { wait: async ms => { waits.push(ms); } });
  assert.deepEqual([...store.files.keys()], [result.marker.id]); assert.deepEqual(waits, [1000]);
  store.hooks.deleteFile = () => { throw new FleetError('source-permission', 'denied'); };
  await a.sync.sync().catch(() => {}); await a.workspace.createGroup('另一組'); await a.sync.sync().catch(() => {});
  await assert.rejects(resetSource(store, { wait: async () => {} }), failCode('source-permission'));
});

test('explicit remote removal and a missing file after cursor restart are errors, never tombstones', async () => {
  for (const mode of ['change', 'rescan']) {
    const store = new MemoryFileStore(); const file = await store.seed(encodeRevision(groupRecord()));
    const c = await client(store); await c.sync.sync(); const before = c.workspace.snapshot;
    store.files.delete(file.id);
    if (mode === 'change') store.changes.push({ id: file.id, removed: true });
    else store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
    await assert.rejects(c.sync.sync(), failCode('source-file-missing'));
    assert.deepEqual(c.workspace.snapshot, before); assert.equal(c.workspace.snapshot.groups[0].deleted, false);
    assert.equal(c.disk().sync.cursor, mode === 'change' ? '1' : null);
  }
});

test('cursor expiration rescans intact remote history and preserves local drafts and pending writes', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(groupRecord()));
  const c = await client(store); await c.sync.sync();
  const draft = c.workspace.blankDraft('g'); draft.content.text = 'keep draft'; await c.workspace.saveDraft(draft);
  await c.workspace.createCard(text('pending'), 'g');
  store.hooks.listChanges = () => { delete store.hooks.listChanges; throw new FleetError('cursor-expired', 'expired'); };
  await c.sync.sync();
  assert.equal(c.workspace.snapshot.cards[0].content.text, 'pending'); assert.equal(c.workspace.state.drafts[draft.id].content.text, 'keep draft');
  assert.equal(c.workspace.pendingOperations.length, 0); assert.equal(store.files.size, 2);
});

test('single flight, rate-limit backoff and revoked authorization are visible without discarding pending writes', async () => {
  const store = new MemoryFileStore(); const entered = gate(); const resume = gate();
  store.hooks.getStartCursor = async () => { entered.resolve(); await resume.promise; throw new FleetError('rate-limit', 'quota', { retryAfterMs: 9000 }); };
  const c = await client(store, { bootstrapGroup: true });
  const first = c.sync.sync(); const same = c.sync.sync(); assert.equal(first, same);
  await entered.promise; resume.resolve(); await assert.rejects(first, failCode('rate-limit'));
  assert.equal(c.sync.status.phase, 'backoff'); assert.equal(c.sync.status.nextAttemptAt, 10000);
  const count = store.calls.length; await assert.rejects(c.sync.sync(), failCode('sync-backoff')); assert.equal(store.calls.length, count);
  store.hooks.getStartCursor = () => { throw new FleetError('unauthorized', 'revoked'); };
  await assert.rejects(c.sync.sync({ force: true }), failCode('unauthorized'));
  assert.equal(c.sync.status.phase, 'needs-login'); assert.equal(c.workspace.pendingOperations.length, 1);
});

test('stop aborts transport and rejects a late reply without writing its payload', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(groupRecord()));
  const entered = gate(); const resume = gate(); let signal;
  store.hooks.readFile = async input => { signal = input.signal; entered.resolve(); await resume.promise; };
  const c = await client(store); const running = c.sync.sync(); await entered.promise;
  await c.sync.stop(); const stopped = c.disk(); assert.equal(signal.aborted, true);
  resume.resolve(); await assert.rejects(running, failCode('stale-session'));
  assert.deepEqual(c.disk(), stopped); assert.equal(c.workspace.state.revisions.length, 0);
  assert.equal(c.sync.status.phase, 'stopped'); await assert.rejects(c.sync.sync(), failCode('stale-session'));
});

test('superseding a session or changing a store account rejects old replies and never binds another profile', async () => {
  for (const replace of ['session', 'source']) {
    const store = new MemoryFileStore(); await store.seed(encodeRevision(groupRecord()));
    const entered = gate(); const resume = gate();
    store.hooks.readFile = async () => { entered.resolve(); await resume.promise; };
    const c = await client(store); const running = c.sync.sync(); await entered.promise;
    if (replace === 'session') await c.workspace.beginSync(store.sourceId);
    else store.sourceId = 'drive:account-b:app-data';
    const before = c.disk(); resume.resolve(); await assert.rejects(running, failCode('stale-session'));
    assert.deepEqual(c.disk(), before);
    await assert.rejects(c.workspace.beginSync('drive:account-b:app-data'), failCode('source-mismatch'));
  }
});

test('bad and looping source pages stop without claiming a completed scan', async () => {
  for (const mode of ['incomplete', 'loop', 'many', 'invalid']) {
    const store = new MemoryFileStore();
    store.listFiles = async () => mode === 'incomplete' ? { files: [], incomplete: true }
      : mode === 'loop' ? { files: [], nextPageToken: 'same' }
      : mode === 'many' ? { files: Array(1001).fill({}) } : { files: [{}] };
    const c = await client(store); await assert.rejects(c.sync.sync());
    assert.equal(c.disk().sync.cursor, null); assert.equal(c.workspace.state.revisions.length, 0);
  }
});

test('file descriptors and integrity checks reject unsafe IDs, oversize data and mutation', async () => {
  const bytes = new Uint8Array([0, 1, 2]); const file = { id: 'valid-id', kind: 'attachment', size: 3, sha256: await sha256(bytes) };
  const result = await verifyFile(file, bytes); result[0] = 3; assert.equal(bytes[0], 0);
  for (const patch of [{ id: '__proto__' }, { id: '../x' }, { kind: 'future' }, { size: -1 }, { size: 25 * 1024 * 1024 + 1 }, { sha256: 'bad' }]) {
    assert.throws(() => validateFile({ ...file, ...patch }), failCode('invalid-source-file'));
  }
  await assert.rejects(verifyFile(file, new Uint8Array([0, 1, 3])), failCode('file-integrity'));
  await assert.rejects(verifyFile(file, new Uint8Array(2)), failCode('file-integrity'));
  const pending = verifyFile(file, bytes); bytes[0] = 99;
  assert.deepEqual(await pending, new Uint8Array([0, 1, 2]), 'caller cannot change verified data while hashing');
});

test('valid provider file IDs that match Object prototype method names remain ordinary immutable entries', async () => {
  const store = new MemoryFileStore(); await store.seed(encodeRevision(groupRecord()), 'revision', 'toString');
  const c = await client(store); await c.sync.sync();
  assert.equal(c.disk().sync.files.toString.id, 'toString');
  c.reopen(); await c.sync.sync(); assert.equal(c.workspace.state.revisions.length, 1);
});
