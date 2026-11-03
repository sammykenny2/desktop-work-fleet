import test from 'node:test';
import assert from 'node:assert/strict';
import { VerifiedRecords } from '../src/sources/dataset-records.js';

const file = (id, size = 2048, extra = {}) => ({ id, size, sha256: 'a'.repeat(64), ...extra });

test('a record is known only under its exact descriptor', () => {
  const records = new VerifiedRecords();
  records.set(file('one'), { text: 'one' });
  assert.deepEqual(records.get(file('one')), { text: 'one' });
  assert.equal(records.get(file('two')), undefined);
  assert.equal(records.get(file('one', 2048, { sha256: 'b'.repeat(64) })), undefined);
  assert.equal(records.get(file('one', 2048, { parentId: 'elsewhere' })), undefined);
});

test('what a caller does with a record cannot change what is remembered', () => {
  const records = new VerifiedRecords(), value = { list: [1] };
  records.set(file('one'), value); value.list.push(2);
  const first = records.get(file('one')); first.list.push(3);
  assert.deepEqual(records.get(file('one')), { list: [1] });
});

test('the size limit evicts what was used longest ago', () => {
  const records = new VerifiedRecords({ limit: 3072 });
  records.set(file('old', 1024), 'old'); records.set(file('used', 1024), 'used'); records.set(file('new', 1024), 'new');
  assert.equal(records.get(file('old', 1024)), 'old');
  assert.equal(records.get(file('used', 1024)), 'used');
  records.set(file('fourth', 1024), 'fourth');
  assert.equal(records.get(file('new', 1024)), undefined, 'the one not asked for since it was added');
  assert.equal(records.get(file('old', 1024)), 'old');
  assert.equal(records.get(file('used', 1024)), 'used');
  assert.equal(records.get(file('fourth', 1024)), 'fourth');
});

test('small records still count against the limit, and one larger than it is not kept', () => {
  const records = new VerifiedRecords({ limit: 3000 });
  for (const id of ['a', 'b', 'c', 'd']) records.set(file(id, 1), id);
  assert.equal(records.get(file('a', 1)), undefined);
  assert.equal(records.get(file('d', 1)), 'd');
  records.set(file('huge', 3001), 'huge');
  assert.equal(records.get(file('huge', 3001)), undefined);
});

test('replacing a record keeps the count right', () => {
  const records = new VerifiedRecords({ limit: 2048 });
  records.set(file('one', 1024), 'first'); records.set(file('one', 1024), 'second'); records.set(file('two', 1024), 'two');
  assert.equal(records.get(file('one', 1024)), 'second');
  assert.equal(records.get(file('two', 1024)), 'two');
});
