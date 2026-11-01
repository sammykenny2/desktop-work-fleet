import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRecordStore, RECORD_LIMITS, recordTransaction, validateRecordTransaction, validateRecordQuery,
  validateRecordStatus, validateRecordPage, recordAttachments } from '../src/storage/records.js';
import { sha256 } from '../src/sources/files.js';

const row = (collection, key, ordinal, value = { text: key }, entity = 'card:one') => ({ collection, key, entity, ordinal, value });

test('record transactions preserve immutable history, compare revisions, and confirm the exact replay', async () => {
  const store = new MemoryRecordStore();
  const first = recordTransaction('local', null, [row('history', 'r0', 0), row('current', 'card:one', 0)]);
  const receipt = await store.commit(first, null);
  assert.deepEqual(await store.commit(first, null), receipt);
  const next = recordTransaction('local', 0, [row('history', 'r1', 1), row('current', 'card:one', 1)]);
  await store.commit(next, 0);
  await assert.rejects(store.commit(recordTransaction('local', 0), 0), { code: 'stale-writer' });
  await assert.rejects(store.commit(recordTransaction('local', 1, [row('current', 'card:one', 2, { text: 'must roll back' }),
    row('history', 'r0', 2, { text: 'changed' })]), 1), { code: 'revision-collision' });
  assert.equal((await store.status('local')).revision, 1);
  assert.equal((await store.get('local', 'current', 'card:one')).ordinal, 1);
  await store.commit(recordTransaction('local', 1, [row('history', 'r0', 2)]), 1);
  assert.equal((await store.get('local', 'history', 'r0')).ordinal, 0, 'replay retains the original history position');
});

test('history pages are entity-scoped, bounded, ordered and reject a changed read boundary', async () => {
  const store = new MemoryRecordStore();
  await store.commit(recordTransaction('local', null, [row('history', 'a', 0), row('history', 'b', 0), row('history', 'c', 0, {}, 'card:other')]), null);
  const first = await store.page('local', { collection: 'history', entity: 'card:one', limit: 1, expectedRevision: 0 });
  assert.deepEqual(first.rows.map(row => row.key), ['b']);
  const last = await store.page('local', { collection: 'history', entity: 'card:one', limit: 1, after: first.next, expectedRevision: 0 });
  assert.deepEqual(last.rows.map(row => row.key), ['a']); assert.equal(last.next, null);
  const ascending = { collection: 'history', entity: 'card:one', limit: 1, expectedRevision: 0, order: 'asc' };
  const earliest = validateRecordPage(await store.page('local', ascending), ascending);
  assert.equal(earliest.rows[0].key, 'a');
  assert.equal((await store.page('local', { ...ascending, after: earliest.next })).rows[0].key, 'b');
  assert.throws(() => validateRecordQuery({ ...ascending, order: 'arbitrary SQL' }), { code: 'invalid-record-transaction' });
  await store.commit(recordTransaction('local', 0), 0);
  await assert.rejects(store.page('local', { collection: 'history', expectedRevision: 0 }), { code: 'stale-writer' });
  assert.equal(await store.get('google:other', 'history', 'a'), null);
});

test('typing touches one record after large history and never mutates a failed candidate', async () => {
  const store = new MemoryRecordStore(); let expected = null;
  for (let offset = 0; offset < 20_000; offset += 500) {
    const ordinal = expected === null ? 0 : expected + 1;
    await store.commit(recordTransaction('local', expected, Array.from({ length: 500 }, (_, index) => row('history', `r${offset + index}`, ordinal))), expected);
    expected = ordinal;
  }
  const before = store.stats;
  await store.commit(recordTransaction('local', expected, [row('draft', 'one', expected + 1, { text: 'one extra character' })]), expected);
  assert.equal(store.stats.writes - before.writes, 1); assert.equal(store.stats.reads - before.reads, 0);
  assert.equal((await store.get('local', 'history', 'r0')).value.text, 'r0');
});

test('closed transactions reject ambiguous targets, unsupported formats and unbounded pages', () => {
  const base = recordTransaction('local', null);
  for (const change of [{ schemaVersion: 2 }, { format: 'legacy' }, { commitId: '-'.repeat(36) },
    { puts: [row('history', 'x', 0), row('history', 'x', 0)] },
    { puts: [row('current', '../path', 0)] }, { puts: [row('unknown', 'x', 0)] },
    { puts: [row('draft', 'one', 1)] }, { extra: true }]) {
    assert.throws(() => validateRecordTransaction({ ...base, ...change }), { code: 'invalid-record-transaction' });
  }
  assert.throws(() => validateRecordQuery({ collection: 'history', limit: 101 }), { code: 'invalid-record-transaction' });
  assert.throws(() => validateRecordQuery({ collection: 'history', after: { ordinal: 0, key: 'x', path: 'no' } }), { code: 'invalid-record-transaction' });
});

test('storage replies cannot substitute another profile, duplicate a page or skip its cursor', async () => {
  const store = new MemoryRecordStore();
  const receipt = await store.commit(recordTransaction('local', null, [row('history', 'a', 0), row('history', 'b', 0)]), null);
  assert.deepEqual(validateRecordStatus(receipt, 'local'), receipt);
  for (const change of [{ profileId: 'google:other' }, { format: 'other' }, { digest: 'no' }, { revision: -1 }, { extra: true }])
    assert.throws(() => validateRecordStatus({ ...receipt, ...change }, 'local'), { code: 'invalid-record-transaction' });
  const query = { collection: 'history', limit: 1, expectedRevision: 0 };
  const page = await store.page('local', query);
  assert.deepEqual(validateRecordPage(page, query), page);
  for (const change of [{ revision: 1 }, { rows: [row('draft', 'b', 0)] }, { next: { ordinal: 0, key: 'a' } },
    { rows: [row('history', 'b', 0), row('history', 'b', 0)] }])
    assert.throws(() => validateRecordPage({ ...page, ...change }, query), { code: 'invalid-record-transaction' });
  assert.throws(() => validateRecordPage(page, { ...query, after: page.next }), { code: 'invalid-record-transaction' });
});

test('large valid rows stop a page before its framing exceeds the transport limit', async () => {
  const store = new MemoryRecordStore(); const text = 'x'.repeat(3 * 1024 * 1024);
  for (let index = 0; index < 3; index++) {
    const expected = index ? index - 1 : null;
    await store.commit(recordTransaction('local', expected, [row('history', `r${index}`, index, { text })]), expected);
  }
  const query = { collection: 'history', expectedRevision: 2 };
  const first = await store.page('local', query), last = await store.page('local', { ...query, after: first.next });
  assert.equal(first.rows.length, 2); assert.equal(last.rows.length, 1); assert.equal(last.next, null);
  assert.ok(new TextEncoder().encode(JSON.stringify(first)).length <= RECORD_LIMITS.pageBytes);
  const oversized = row('history', 'large', 0, { text: 'x'.repeat(RECORD_LIMITS.rowBytes) });
  assert.throws(() => recordTransaction('local', null, [oversized]), { code: 'native-capacity' });
});

test('attachment integrity and a stale writer never partially publish a transaction', async () => {
  const store = new MemoryRecordStore(), bytes = new TextEncoder().encode('attachment'); const id = await sha256(bytes);
  await store.commit(recordTransaction('local', null), null);
  await assert.rejects(store.commit(recordTransaction('local', 0, [row('draft', 'one', 1)]), 0,
    { attachments: [{ id, bytes: new Uint8Array([0]) }] }), { code: 'attachment-integrity' });
  assert.equal(await store.get('local', 'draft', 'one'), null);
  assert.equal((await store.status('local')).revision, 0);
  await store.commit(recordTransaction('local', 0), 0, { attachments: [{ id, bytes }] });
  assert.equal(await (await store.getAttachment('local', id)).text(), 'attachment');
  assert.equal(await store.getAttachment('google:other', id), null);
  await assert.rejects(store.commit(recordTransaction('local', 0), 0), { code: 'stale-writer' });
  const large = new Uint8Array(RECORD_LIMITS.attachmentBytes);
  await assert.rejects(recordAttachments(Array.from({ length: 6 }, (_, index) => ({ id: String(index).padStart(64, '0'), bytes: large }))),
    { code: 'native-capacity' });
});
