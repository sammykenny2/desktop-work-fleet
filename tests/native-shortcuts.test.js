import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeShortcutSettings } from '../src/native/shortcuts.js';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('native shortcut settings snapshot and coalesce replacements, preserve real statuses and avoid unchanged re-registration', async () => {
  const calls = [], status = []; let settle, listener;
  const bridge = { onEvent: (_, value) => { listener = value; return () => { listener = null; }; }, request: (method, args) => {
    calls.push({ method, args }); return new Promise(resolve => { settle = resolve; });
  } };
  const settings = new NativeShortcutSettings(bridge, value => status.push(value), assert.fail);
  const original = { 'Ctrl+Shift+1': 'original' }; const pending = settings.update(original); original['Ctrl+Shift+1'] = 'changed';
  settings.update({ 'Ctrl+Shift+1': 'intermediate' }); settings.update({ 'Ctrl+Shift+1': 'latest' });
  assert.equal(calls.length, 1); assert.equal(calls[0].args.bindings[0].target, 'original');
  listener({ registrations: [{ status: 'suspended' }] }); assert.equal(status.at(-1)[0].status, 'suspended');
  settle({ registrations: [{ status: 'conflict' }] }); await tick();
  assert.equal(calls.length, 2); assert.equal(calls[1].args.bindings[0].target, 'latest');
  settle({ registrations: [{ status: 'available' }] }); await pending;
  await settings.update({ 'Ctrl+Shift+1': 'latest' }); assert.equal(calls.length, 2);
  assert.equal(status.at(-1)[0].status, 'available'); settings.close(); assert.equal(listener, null);
});

test('failed native registration configuration reports once, explicit retry works and late replies after close are ignored', async () => {
  let calls = 0, settle; const errors = [], status = [];
  const settings = new NativeShortcutSettings({ onEvent: () => () => {}, request: () => {
    calls++; if (calls === 1) return Promise.reject(new Error('unavailable')); return new Promise(resolve => { settle = resolve; });
  } }, value => status.push(value), error => errors.push(error));
  const bindings = { 'Ctrl+Alt+N': '@capture' };
  await settings.update(bindings); await settings.update(bindings); assert.equal(calls, 1); assert.equal(errors.length, 1);
  const retried = settings.update(bindings, true); assert.equal(calls, 2); settings.close();
  settle({ registrations: [] }); await retried; assert.equal(status.length, 0); settings.update(bindings, true); assert.equal(calls, 2);
});

test('labwc keybinds are written only on request, after pending bindings, and report the rc.xml state', async () => {
  const calls = [], status = []; let settle, listener;
  const bridge = { onEvent: (_, value) => { listener = value; return () => { listener = null; }; }, request: (method, args) => {
    calls.push(method); return method === 'desktop.shortcuts.labwc'
      ? Promise.resolve({ registrations: [{ key: 'Ctrl+Shift+1', status: 'available' }], labwc: { state: 'current', path: 'rc.xml' } })
      : new Promise(resolve => { settle = resolve; });
  } };
  const settings = new NativeShortcutSettings(bridge, (value, labwc) => status.push([value, labwc]), assert.fail);
  settings.update({ 'Ctrl+Shift+1': 'group-1' }); const written = settings.writeLabwc(); await tick();
  assert.deepEqual(calls, ['desktop.shortcuts.configure'], 'the keys being configured are written, not the previous ones');
  settle({ registrations: [{ key: 'Ctrl+Shift+1', status: 'unwritten' }], labwc: { state: 'absent', path: 'rc.xml' } }); await written;
  assert.deepEqual(calls, ['desktop.shortcuts.configure', 'desktop.shortcuts.labwc']);
  assert.deepEqual(status.map(([, labwc]) => labwc.state), ['absent', 'current']);
  listener({ registrations: [] }); assert.equal(status.at(-1)[1], null, 'other hosts report no labwc state');
  settings.close();
});
