import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultShortcuts, eventShortcut, isEditingShortcut, normalizeShortcut, regionShortcuts, resolveShortcuts, shortcutForEvent,
  validateShortcuts } from '../src/core/shortcuts.js';
import { Workspace } from '../src/core/workspace.js';

test('shortcut validation normalizes modifiers, preserves stable targets and refuses collisions or plain typing', () => {
  assert.equal(normalizeShortcut('shift + control + a'), 'Ctrl+Shift+A');
  assert.equal(normalizeShortcut('command+option+F24'), 'Alt+Meta+F24');
  for (const invalid of ['A', 'Shift+1', 'Ctrl+Ctrl+A', 'Ctrl+', 'constructor+N', 'Ctrl+F25', 'Ctrl+ArrowLeft']) {
    assert.throws(() => normalizeShortcut(invalid), error => error.code === 'invalid-shortcut');
  }
  assert.deepEqual(validateShortcuts({ 'control+shift+1': 'stable-id' }, [{ id: 'stable-id' }]), { 'Ctrl+Shift+1': 'stable-id' });
  assert.throws(() => validateShortcuts({ 'Ctrl+A': '@all', 'control+a': '@capture' }, []), error => error.code === 'duplicate-shortcut');
  assert.throws(() => validateShortcuts({ 'Ctrl+A': 'missing' }, []), error => error.code === 'invalid-shortcut-target');
  assert.deepEqual(validateShortcuts({ 'Ctrl+Shift+9': '@region9' }, []), { 'Ctrl+Shift+9': '@region9' });
  for (const target of ['@region0', '@region10']) {
    assert.throws(() => validateShortcuts({ 'Ctrl+A': target }, []), error => error.code === 'invalid-shortcut-target');
  }
});

test('digit keys follow desktop regions: 0 for every group, 1-9 for regions, empty regions stay free', () => {
  const defaults = defaultShortcuts();
  assert.equal(defaults['Ctrl+Shift+0'], '@all'); assert.equal(defaults['Ctrl+Shift+N'], '@capture'); assert.equal(defaults['Ctrl+Shift+D'], '@toggle');
  for (let number = 1; number <= 9; number++) assert.equal(defaults[`Ctrl+Shift+${number}`], `@region${number}`);
  // Regions resolve to the group they hold now; a key for an empty or missing region is not bound at all.
  assert.deepEqual(resolveShortcuts({ 'Ctrl+Shift+1': '@region1', 'Ctrl+Shift+2': '@region2', 'Ctrl+Shift+3': '@region3', 'Ctrl+Shift+0': '@all', 'Ctrl+1': 'legacy' },
    ['b', null]), { 'Ctrl+Shift+1': 'b', 'Ctrl+Shift+0': '@all', 'Ctrl+1': 'legacy' });
});

test('group-bound keys from older layouts move to the region holding the group and fill missing digits once', () => {
  const legacy = { 'Ctrl+Shift+1': 'a', 'Alt+F2': 'b', 'Ctrl+Shift+7': 'gone', 'Ctrl+Shift+0': '@all' };
  const migrated = regionShortcuts(legacy, ['b', 'a', null]);
  assert.equal(migrated['Ctrl+Shift+1'], '@region2', 'a key follows its group into the group region');
  assert.equal(migrated['Alt+F2'], '@region1'); assert.equal(migrated['Ctrl+Shift+0'], '@all');
  assert.equal(Object.hasOwn(migrated, 'Ctrl+Shift+2'), false, 'region 2 already has a key, so its default is not added');
  assert.equal(migrated['Ctrl+Shift+3'], '@region3'); assert.equal(migrated['Ctrl+Shift+9'], '@region9');
  assert.equal(migrated['Ctrl+Shift+7'], '@region7', 'a key for a group without a region is dropped and the digit returns to its region');
  assert.equal(Object.values(migrated).some(target => !target.startsWith('@')), false);
  // Once nothing is bound to a group, a cleared region key stays cleared.
  const cleared = { ...migrated }; delete cleared['Ctrl+Shift+9'];
  assert.deepEqual(regionShortcuts(cleared, ['b', 'a', null]), cleared);
});

test('a workspace opened from an older layout uses region keys without moving anything else', async () => {
  const saved = []; const area = { x: 0, y: 0, width: 1200, height: 800 };
  const created = await Workspace.create({ profileId: 'local', deviceId: 'device', area, persist: async state => { saved.push(state); } });
  const state = created.state; const [group] = state.groups;
  state.layout.shortcuts = { 'Ctrl+Shift+1': group.id, 'Ctrl+Shift+0': '@all' };
  state.schemaVersion = 1;
  const opened = new Workspace(state, async () => {});
  assert.equal(opened.layout.state.shortcuts['Ctrl+Shift+1'], '@region1'); assert.equal(opened.layout.state.shortcuts['Ctrl+Shift+2'], '@region2');
  assert.deepEqual(opened.layout.state.grid, state.layout.grid); assert.equal(opened.layout.state.revision, state.layout.revision);
  assert.equal(opened.state.layout.shortcuts['Ctrl+Shift+1'], '@region1', 'workspace and layout store agree');
});

test('focused shortcut routing preserves editing, composition, repeat, modal and inline scope priorities', () => {
  const event = { code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true };
  const bindings = { 'Ctrl+Shift+1': 'stable', 'Ctrl+Shift+0': '@all', 'Ctrl+Shift+N': '@capture', 'Ctrl+C': '@all' };
  assert.deepEqual(shortcutForEvent(event, bindings), { key: 'Ctrl+Shift+1', target: 'stable' });
  assert.deepEqual(shortcutForEvent(event, bindings, { editing: true, inline: true }), { key: 'Ctrl+Shift+1', target: 'stable' });
  for (const overrides of [{ isComposing: true }, { repeat: true }, { defaultPrevented: true }, { keyCode: 229 }]) assert.equal(shortcutForEvent({ ...event, ...overrides }, bindings), null);
  for (const options of [{ composing: true }, { modal: true }, { editing: true }]) assert.equal(shortcutForEvent(event, bindings, options), null);
  assert.equal(shortcutForEvent({ ...event, code: 'KeyN' }, bindings, { editing: true, inline: true }), null);
  assert.equal(shortcutForEvent({ code: 'KeyC', ctrlKey: true }, bindings, { editing: true, inline: true }), null);
  assert.equal(shortcutForEvent(event, {}), null);
  assert.equal(shortcutForEvent({ code: 'KeyQ', key: '@', ctrlKey: true, altKey: true, getModifierState: name => name === 'AltGraph' },
    { 'Ctrl+Alt+Q': 'group' }, { editing: true, inline: true }), null);
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
