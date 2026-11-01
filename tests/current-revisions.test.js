import test from 'node:test';
import assert from 'node:assert/strict';
import { CurrentRevisions } from '../src/sources/current-revisions.js';
import { revisionRecord } from '../src/sources/revisions.js';

const note = (revision, parents = [], id = 'one', text = revision) => revisionRecord('card', {
  id, revision, groupId: 'group', content: { format: 'markdown', text }, deleted: false, archived: false, completed: false,
}, parents);
const heads = graph => graph.heads('card', 'one').map(row => row.revisionId);

test('current heads open without historical bodies and a direct successor replaces exactly its parents', () => {
  const base = new CurrentRevisions([note('r30', ['r29'])]);
  assert.deepEqual(base.pending, []); assert.deepEqual(base.missing, []);
  const next = base.fork([note('r31', ['r30'])]);
  assert.deepEqual(heads(base), ['r30']); assert.deepEqual(heads(next), ['r31']);
  assert.equal(next.get('r30'), null);
});

test('unknown ancestry preserves concurrent content and resolving all previewed heads joins it', () => {
  const base = new CurrentRevisions([note('r30', ['r29'])]);
  const late = base.fork([note('r31', ['r4'])]);
  assert.deepEqual(heads(late), ['r30', 'r31']);
  assert.deepEqual(heads(late.fork([note('r32', ['r30'])])), ['r31', 'r32']);
  assert.deepEqual(heads(late.fork([note('r32', ['r30', 'r31'])])), ['r32']);
  assert.deepEqual(heads(base.fork([note('r1', ['r0'])])), ['r1', 'r30'], 'unknown late ancestors are conservative conflicts');
});

test('a bounded batch proves transitive order regardless of delivery order and rejects cycles and identity collisions', () => {
  const graph = new CurrentRevisions([note('r3', ['r2']), note('r1'), note('r2', ['r1'])]);
  assert.deepEqual(heads(graph), ['r3']);
  assert.deepEqual(heads(graph.fork([note('r3', ['r2'])])), ['r3']);
  assert.throws(() => graph.fork([note('r3', ['r2'], 'one', 'different')]), { code: 'revision-collision' });
  assert.throws(() => graph.fork([note('r2', ['r3'])]), { code: 'revision-cycle' });
  assert.throws(() => graph.fork([note('other', ['r3'], 'two')]), { code: 'parent-identity' });
  assert.deepEqual(heads(graph), ['r3']);
});

test('repeated saves retain current values without accumulating history or ancestry indexes', () => {
  let graph = new CurrentRevisions([note('r0')]);
  for (let i = 1; i <= 10_000; i++) graph = graph.fork([note(`r${i}`, [`r${i - 1}`])]);
  assert.equal(graph.size, 1); assert.equal(graph.records.length, 1);
  assert.deepEqual(heads(graph), ['r10000']);
});
