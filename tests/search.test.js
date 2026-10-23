import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_LINES, rankSearch, searchTier } from '../src/app/search.js';

const card = (id, text, title) => ({ id, content: { text, ...(title ? { title } : {}) } });

test('a match ranks by where it first appears: title or first line, the lead lines, then anywhere', () => {
  assert.equal(searchTier(card('a', 'Plan the trip\nbook flights'), 'trip'), 0);
  assert.equal(searchTier(card('b', '\n\n  \nPlan the trip'), 'trip'), 0, 'blank lines before the first line do not count');
  assert.equal(searchTier(card('c', 'Plan the trip', 'Holiday'), 'trip'), 1, 'with a title, the first line is a lead line');
  assert.equal(searchTier(card('d', 'Body', 'Holiday trip'), 'trip'), 0);
  const lead = ['one', 'two', 'three', 'four', 'trip five', 'trip six'].join('\n');
  assert.equal(LEAD_LINES, 5);
  assert.equal(searchTier(card('e', lead), 'trip'), 1);
  assert.equal(searchTier(card('f', ['one', 'two', 'three', 'four', 'five', 'trip six'].join('\n')), 'trip'), 2);
  assert.equal(searchTier(card('g', 'nothing here'), 'trip'), -1);
});

test('ranked search keeps the order within a tier and leaves an empty query alone', () => {
  const cards = [
    card('rest', 'one\ntwo\nthree\nfour\nfive\nthe trip at last'),
    card('lead', 'Notes\nthe trip soon'),
    card('first', 'Trip list'),
    card('miss', 'groceries'),
    card('titled', 'packing', 'Trip'),
    card('lead2', 'Other\ntrip again'),
  ];
  assert.deepEqual(rankSearch(cards, 'trip').map(value => value.id), ['first', 'titled', 'lead', 'lead2', 'rest']);
  assert.equal(rankSearch(cards, ''), cards);
});

test('a query is matched against the lowercased note, as the search box lowercases it', () => {
  assert.equal(searchTier(card('a', 'ÉTÉ plans'), 'été'), 0);
  assert.equal(searchTier(card('b', 'x', 'Q4 Review'), 'review'), 0);
});
