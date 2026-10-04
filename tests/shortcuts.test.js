import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultShortcuts, eventShortcut, isEditingShortcut, normalizeShortcut, validateShortcuts } from '../src/core/shortcuts.js';

test('shortcut validation normalizes modifiers, preserves stable targets and refuses collisions or plain typing', () => {
  assert.equal(normalizeShortcut('shift + control + a'), 'Ctrl+Shift+A');
  assert.equal(normalizeShortcut('command+option+F24'), 'Alt+Meta+F24');
  for (const invalid of ['A', 'Shift+1', 'Ctrl+Ctrl+A', 'Ctrl+', 'constructor+N', 'Ctrl+F25', 'Ctrl+ArrowLeft']) {
    assert.throws(() => normalizeShortcut(invalid), error => error.code === 'invalid-shortcut');
  }
  assert.deepEqual(validateShortcuts({ 'control+shift+1': 'stable-id' }, [{ id: 'stable-id' }]), { 'Ctrl+Shift+1': 'stable-id' });
  assert.throws(() => validateShortcuts({ 'Ctrl+A': '@all', 'control+a': '@capture' }, []), error => error.code === 'duplicate-shortcut');
  assert.throws(() => validateShortcuts({ 'Ctrl+A': 'missing' }, []), error => error.code === 'invalid-shortcut-target');
  const defaults = defaultShortcuts([{ id: 'a' }, { id: 'b' }]);
  assert.equal(defaults['Ctrl+Shift+1'], 'a'); assert.equal(defaults['Ctrl+Shift+0'], '@all');
});

test('browser shortcut dispatch uses stable physical number keys and ignores IME/repeat', () => {
  const event = { code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true };
  assert.equal(eventShortcut(event), 'Ctrl+Shift+1');
  assert.equal(eventShortcut({ ...event, isComposing: true }), null);
  assert.equal(eventShortcut({ ...event, repeat: true }), null);
  assert.equal(eventShortcut({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), null);
  for (const code of ['KeyA', 'KeyC', 'KeyX', 'KeyV', 'KeyZ', 'KeyY']) {
    assert.equal(isEditingShortcut({ code, ctrlKey: true }), true);
    assert.equal(isEditingShortcut({ code, metaKey: true, shiftKey: true }), true);
  }
  assert.equal(isEditingShortcut({ code: 'Digit1', ctrlKey: true, shiftKey: true }), false);
});
