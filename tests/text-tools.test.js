import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleLinePrefix, toggleWrap } from '../src/app/text-tools.js';

const apply = (text, edit) => text.slice(0, edit.from) + edit.replacement + text.slice(edit.to);

test('a line tool marks the line the caret is on and keeps the caret on the same words', () => {
  const text = 'first\nsecond\nthird'; const caret = text.indexOf('cond');
  const edit = toggleLinePrefix(text, caret, caret, '- [ ] ');
  assert.equal(apply(text, edit), 'first\n- [ ] second\nthird');
  assert.equal(apply(text, edit).slice(edit.selectionStart, edit.selectionStart + 4), 'cond');
  assert.equal(edit.selectionStart, edit.selectionEnd);
});

test('on an empty note a line tool leaves the caret after the mark', () => {
  const edit = toggleLinePrefix('', 0, 0, '- [ ] ');
  assert.equal(apply('', edit), '- [ ] '); assert.equal(edit.selectionStart, 6);
});

test('pressing a line tool again takes the mark off, including a ticked step', () => {
  const marked = toggleLinePrefix('- [ ] step', 3, 3, '- [ ] ');
  assert.equal(apply('- [ ] step', marked), 'step'); assert.equal(marked.selectionStart, 0);
  assert.equal(apply('- [x] done', toggleLinePrefix('- [x] done', 8, 8, '- [ ] ')), 'done');
  assert.equal(apply('## title', toggleLinePrefix('## title', 3, 3, '## ')), 'title');
});

test('a line tool replaces another mark instead of stacking on it', () => {
  assert.equal(apply('- item', toggleLinePrefix('- item', 0, 0, '- [ ] ')), '- [ ] item');
  assert.equal(apply('- [ ] item', toggleLinePrefix('- [ ] item', 0, 0, '- ')), '- item');
  assert.equal(apply('## item', toggleLinePrefix('## item', 0, 0, '- ')), '- item');
});

test('a line tool covers every selected line and passes over empty ones', () => {
  const text = 'one\n\ntwo\nthree';
  const edit = toggleLinePrefix(text, 0, text.indexOf('three'), '- ');
  assert.equal(apply(text, edit), '- one\n\n- two\nthree', 'a selection ending at the start of a line leaves that line alone');
  assert.equal(edit.selectionStart, 0); assert.equal(edit.selectionEnd, '- one\n\n- two'.length);
  const again = toggleLinePrefix('- one\n\n- two', 0, '- one\n\n- two'.length, '- ');
  assert.equal(apply('- one\n\n- two', again), 'one\n\ntwo');
  const mixed = toggleLinePrefix('- one\ntwo', 0, 9, '- ');
  assert.equal(apply('- one\ntwo', mixed), '- one\n- two', 'lines not all marked all get the mark');
});

test('a blank first line is a line of its own', () => {
  const edit = toggleLinePrefix('\nabc', 0, 0, '- ');
  assert.deepEqual([edit.from, edit.to], [0, 0]); assert.equal(apply('\nabc', edit), '- \nabc'); assert.equal(edit.selectionStart, 2);
});

test('an indented list line keeps its indent', () => {
  assert.equal(apply('  - nested', toggleLinePrefix('  - nested', 5, 5, '- [ ] ')), '  - [ ] nested');
  assert.equal(apply('  - nested', toggleLinePrefix('  - nested', 5, 5, '- ')), '  nested');
  assert.equal(apply('  plain', toggleLinePrefix('  plain', 3, 3, '- ')), '  - plain');
});

test('a wrap tool wraps a selection, unwraps it either way, and waits between marks without one', () => {
  const wrapped = toggleWrap('make this bold', 5, 9, '**');
  assert.equal(apply('make this bold', wrapped), 'make **this** bold');
  assert.deepEqual([wrapped.selectionStart, wrapped.selectionEnd], [7, 11]);
  const inner = toggleWrap('make **this** bold', 7, 11, '**');
  assert.equal(apply('make **this** bold', inner), 'make this bold');
  assert.deepEqual([inner.selectionStart, inner.selectionEnd], [5, 9]);
  assert.equal(apply('**this**', toggleWrap('**this**', 0, 8, '**')), 'this');
  const empty = toggleWrap('ab', 1, 1, '**');
  assert.equal(apply('ab', empty), 'a****b'); assert.deepEqual([empty.selectionStart, empty.selectionEnd], [3, 3]);
});
