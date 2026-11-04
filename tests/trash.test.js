import test from 'node:test';
import assert from 'node:assert/strict';
import { trashSections } from '../src/app/trash.js';

const card = (id, groupId, trashedAt) => ({ id, groupId, trashedAt });
const shape = sections => sections.map(section => [section.groupId, section.cards.map(item => item.id)]);

test('Trash sections follow the group order, with groups no longer listed last and empty groups left out', () => {
  const cards = [card('a', 'gone', '2026-11-01T00:00:00.000Z'), card('b', 'second', '2026-11-01T00:00:00.000Z'), card('c', 'first', '2026-11-01T00:00:00.000Z')];
  assert.deepEqual(shape(trashSections(cards, ['first', 'empty', 'second'])), [['first', ['c']], ['second', ['b']], ['gone', ['a']]]);
});

test('inside a section the most recently trashed note comes first, and a note without a time comes last', () => {
  const cards = [card('old', 'g', '2026-10-01T00:00:00.000Z'), card('untimed', 'g'), card('new', 'g', '2026-11-01T00:00:00.000Z')];
  assert.deepEqual(shape(trashSections(cards, ['g'])), [['g', ['new', 'old', 'untimed']]]);
});

test('a search keeps its ranking inside each section', () => {
  const cards = [card('best', 'g', '2026-10-01T00:00:00.000Z'), card('next', 'g', '2026-11-01T00:00:00.000Z')];
  assert.deepEqual(shape(trashSections(cards, ['g'], { ranked: true })), [['g', ['best', 'next']]]);
});
