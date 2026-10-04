import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy, FleetError } from '../src/core/contracts.js';
import { FileSync } from '../src/sources/file-sync.js';
import { sha256, validateFile, verifyFile } from '../src/sources/files.js';
import { encodeRevision, revisionRecord } from '../src/sources/revisions.js';
import { gate, MemoryAttachmentStorage, MemoryFileStore } from './fixtures/file-store.js';

const area = { x: 0, y: 0, width: 1400, height: 900 };
const text = value => ({ format: 'markdown', text: value });
const failCode = code => error => error.code === code;
const groupRecord = (id = 'g', revision = 'g-root') => revisionRecord('group', { id, revision, name: id, deleted: false });

async function client(fileStore, { bootstrapGroup = false, profileId = 'account-a' } = {}) {
  let disk; let fail = () => false;
  const persist = async (state, revision) => {
    if (fail(state)) throw new Error('disk full');
    assert.equal(disk?.revision ?? null, revision); disk = copy(state);
  };
  let workspace = await Workspace.create({ profileId, deviceId: crypto.randomUUID(), bootstrapGroup, area, persist });
  const storage = new MemoryAttachmentStorage();
  let sync = new FileSync({ workspace, storage, fileStore, now: () => 1000, random: () => 0 });
  return { get workspace() { return workspace; }, get sync() { return sync; }, storage, disk: () => copy(disk),
    fail: callback => { fail = callback; },
    reopen: () => { workspace = new Workspace(disk, persist); sync = new FileSync({ workspace, storage, fileStore }); },
  };
}

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
