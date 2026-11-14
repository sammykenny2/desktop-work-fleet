import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../src/core/contracts.js';
import { Workspace } from '../src/core/workspace.js';
import { DeskStore, seedDesk } from '../src/layout/desk.js';
import { isFront, lastOrder, layoutHighWater, maxOrder, orderRange, restorePaper, visualOrder, zeroOrder } from '../src/layout/stacking.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const label = index => orderRange(zeroOrder, index).at(-1);
const content = text => ({ text, format: 'markdown', attachments: [] });
const ids = (layout, cards = Object.keys(layout.placements).map(id => ({ id }))) => visualOrder(cards, layout).map(card => card.id);

test('Z21/Z22: old order fallback, exact hexadecimal labels and refusal at the 128-bit boundary', () => {
  const layout = { placements: { a: { order: 1 }, b: { order: 1 }, c: { order: 0 } }, owners: { a: 'local', b: 'google:a' } };
  assert.deepEqual(ids(layout), ['c', 'b', 'a']);
  layout.placements.c.zOrder = label(1); assert.deepEqual(ids(layout), ['b', 'a', 'c']);
  assert.equal(maxOrder(undefined, label(2), label(1)), label(2));
  assert.deepEqual(orderRange('fffffffffffffffffffffffffffffffe', 1), [lastOrder]);
  assert.throws(() => orderRange(lastOrder, 1), { code: 'stacking-exhausted' });
  for (const value of [null, 1, '1', 'F'.repeat(32), '0'.repeat(33)]) {
    assert.throws(() => maxOrder(value), { code: 'invalid-stacking' });
  }
  assert.ok(isFront(['a', 'b', 'c'], ['b', 'c'])); assert.ok(!isFront(['a', 'b', 'c'], ['c', 'b']));
});

test('Z12: conditional label restoration preserves a later attention raise and old absent fields', () => {
  const before = { x: 1, y: 2, order: 1 };
  const paper = { x: 10, y: 20, order: 1, zOrder: label(3) };
  restorePaper(paper, before, label(2)); assert.equal(paper.zOrder, label(3)); assert.equal(paper.x, 1);
  restorePaper(paper, before, label(3)); assert.ok(!Object.hasOwn(paper, 'zOrder'));
  paper.zOrder = label(4); restorePaper(paper, before, undefined); assert.equal(paper.zOrder, label(4));
});

test('Z22: reservations serialize without invalidating a visual layout revision; failed ranges are never reused', async () => {
  let disk, fail = false;
  const desk = new DeskStore({ revision: 4 }, async value => { if (fail) throw new Error('disk full'); disk = copy(value); });
  const [first, second] = await Promise.all([desk.reserveOrders(2), desk.reserveOrders(1)]);
  assert.deepEqual([...first, ...second], orderRange(zeroOrder, 3)); assert.equal(desk.state.revision, 4);
  fail = true; await assert.rejects(desk.reserveOrders(2), /disk full/); assert.equal(disk.zOrderCounter, label(3));
  fail = false; assert.deepEqual(await desk.reserveOrders(1), [label(6)]); assert.equal(disk.zOrderCounter, label(6));
});

test('Z22: a real record-store lost acknowledgement is reconciled by exact commit, then survives reopening', async () => {
  const records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'local');
  const workspace = await Workspace.create({ profileId: 'local', deviceId: 'device', area, current: true,
    history: storage, persist: (...args) => storage.save(...args) });
  const original = records.commit.bind(records); let lose = true;
  records.commit = async (...args) => {
    const receipt = await original(...args);
    if (lose) { lose = false; throw new Error('reply lost after commit'); }
    return receipt;
  };
  const desk = new DeskStore(seedDesk(workspace.layout.state), value => storage.putControl('desk', value));
  assert.deepEqual(await desk.reserveOrders(2), orderRange(zeroOrder, 2));
  await workspace.createCard(content('kept after the unknown reply'));
  const reopened = new WorkspaceRecordStorage(records, 'local');
  const saved = await reopened.load('local'); assert.equal(saved.cards[0].content.text, 'kept after the unknown reply');
  const next = new DeskStore(await reopened.getControl('desk'), value => reopened.putControl('desk', value));
  assert.deepEqual(await next.reserveOrders(1), [label(3)]);
});

test('Z22: failure before durability leaves content untouched; concurrent content and control writes keep CAS', async () => {
  const records = new MemoryRecordStore(), storage = new WorkspaceRecordStorage(records, 'local');
  const workspace = await Workspace.create({ profileId: 'local', deviceId: 'device', area, current: true,
    history: storage, persist: (...args) => storage.save(...args) });
  const original = records.commit.bind(records); let fail = true;
  records.commit = async (...args) => { if (fail) throw new Error('before durability'); return original(...args); };
  const desk = new DeskStore(seedDesk(workspace.layout.state), value => storage.putControl('desk', value));
  const before = workspace.state;
  await assert.rejects(desk.reserveOrders(1), /before durability/); assert.deepEqual(workspace.state, before);
  fail = false;
  await Promise.all([desk.reserveOrders(1), workspace.createCard(content('independent note'))]);
  assert.equal(desk.state.zOrderCounter, label(2)); assert.equal(workspace.snapshot.cards.length, 1);
  assert.equal((await storage.load('local')).cards[0].content.text, 'independent note');
  assert.equal(layoutHighWater({ placements: { a: { zOrder: label(4) } }, zOrderCounter: label(2) }), label(4));
});
