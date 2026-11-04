import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationQueue } from '../src/app/notifications.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { t } from '../src/i18n/index.js';

function clock() {
  let now = 0, next = 0; const timers = new Map();
  const queue = new NotificationQueue({ now: () => now,
    schedule: (callback, delay) => { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; },
    cancel: id => timers.delete(id) });
  return { queue, tick(milliseconds) {
    const end = now + milliseconds;
    for (;;) {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!timer || timer.at > end) break;
      now = timer.at; timers.delete(id); timer.callback();
    }
    now = end;
  } };
}

test('results expire, while errors, running work and Undo wait for explicit dismissal', () => {
  const { queue, tick } = clock();
  queue.show('Saved', { id: 'saved' });
  queue.show('Disk full', { id: 'error', kind: 'error' });
  queue.show('Writing', { id: 'progress', kind: 'progress' });
  queue.show('Deleted', { id: 'undo', action: { label: 'Undo', run() {} } });
  tick(60000);
  assert.deepEqual([...queue.items.keys()], ['error', 'progress', 'undo']);
  queue.dismiss('error'); assert.equal(queue.items.has('error'), false);
});

test('hover, focus and a hidden page pause expiration independently', () => {
  const { queue, tick } = clock(); queue.show('Saved', { id: 'saved', duration: 5000 });
  tick(2000); queue.pause('saved', 'pointer', true); queue.pause('saved', 'focus', true);
  tick(10000); queue.pause('saved', 'pointer', false); tick(10000);
  assert.equal(queue.items.has('saved'), true);
  queue.pause('saved', 'focus', false); tick(1000); queue.pause('saved', 'hidden', true);
  tick(10000); queue.pause('saved', 'hidden', false); tick(1999);
  assert.equal(queue.items.has('saved'), true); tick(1); assert.equal(queue.items.has('saved'), false);
});

test('a polled failure stays dismissed, but a genuinely new attempt can report the same failure', () => {
  const { queue } = clock(); const options = { id: 'cloud-cleanup', kind: 'error' };
  queue.show('Offline', options); queue.dismiss(options.id);
  queue.show('Offline', options); assert.equal(queue.items.size, 0);
  queue.show('Retrying', { id: options.id, kind: 'progress' });
  queue.show('Offline', options); assert.equal(queue.items.get(options.id).text, 'Offline');
});

test('closing a progress notice suppresses phase updates until its terminal result', () => {
  const { queue, tick } = clock(); const options = { id: 'backup', kind: 'progress' };
  queue.show('Reading', options); queue.dismiss(options.id); queue.show('Encrypting', options);
  assert.equal(queue.items.size, 0);
  queue.show('Backed up', { id: options.id }); assert.equal(queue.items.get(options.id).kind, 'info');
  tick(15000); queue.show('Reading', options); queue.show('Backed up', { id: options.id });
  assert.equal(queue.items.get(options.id).text, 'Backed up');
});

test('a later save leaves Undo and an independent collection failure available', () => {
  const { queue, tick } = clock(); const undo = { label: 'Undo', run() {} };
  queue.show('Deleted', { id: 'undo', action: undo });
  queue.show('Local cleanup failed', { id: 'maintenance:local', kind: 'error' });
  queue.show('Cloud cleanup finished', { id: 'maintenance:cloud' });
  queue.show('Saved', { id: 'saved' }); tick(30000);
  assert.equal(queue.items.get('undo').action, undo);
  assert.equal(queue.items.has('maintenance:local'), true);
});

test('deduplication preserves the timeout but refreshes an action from a rebuilt panel', () => {
  const { queue, tick } = clock(); queue.show('Saved', { id: 'saved', duration: 5000 });
  tick(4000); queue.show('Saved', { id: 'saved', duration: 5000 }); tick(1000);
  assert.equal(queue.items.has('saved'), false);
  const old = { label: 'Retry', run() {} }, fresh = { label: 'Retry', run() {} };
  queue.show('Failed', { id: 'history', kind: 'error', action: old });
  queue.show('Failed', { id: 'history', kind: 'error', action: fresh });
  assert.equal(queue.items.get('history').action, fresh);
});

test('a new explicit result renews the same notice while preserving a focused pause', () => {
  const { queue, tick } = clock(); queue.show('Saved', { id: 'save', duration: 5000 });
  queue.pause('save', 'focus', true); tick(10000);
  queue.show('Saved', { id: 'save', renew: true, duration: 5000 }); tick(10000);
  assert.equal(queue.items.has('save'), true);
  queue.pause('save', 'focus', false); tick(4999); assert.equal(queue.items.has('save'), true);
  tick(1); assert.equal(queue.items.has('save'), false);
  queue.show('Saved', { id: 'save', renew: true }); assert.equal(queue.items.has('save'), true);
});

test('automatic-backup polling does not replay a dismissed failure before a successful backup', async () => {
  const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
  const monitor = source.slice(source.indexOf('function monitorAutomatic('), source.indexOf('async function showIncompatibleLocal('));
  const { queue } = clock(); let listener;
  const service = { status: { lastSuccess: null }, subscribe(callback) { listener = callback; callback(this.status); return () => {}; } };
  const context = vm.createContext({ service, files: {}, profile: 'local', notifications: () => queue, t, sectionName: id => id,
    run: action => action(), addEventListener() {} });
  vm.runInContext(`${monitor}\nmonitorAutomatic({service, files}, profile)`, context);
  listener({ error: { message: 'Offline' }, lastSuccess: null });
  queue.dismiss('automatic-backup:local');
  listener({ error: null, lastSuccess: null });
  listener({ error: { message: 'Offline' }, lastSuccess: null });
  assert.equal(queue.items.size, 0);
  listener({ error: null, lastSuccess: { savedAt: '2026-11-05T00:00:00Z', name: 'verified.zip' } });
  listener({ error: { message: 'Offline' }, lastSuccess: { savedAt: '2026-11-05T00:00:00Z', name: 'verified.zip' } });
  assert.equal(queue.items.get('automatic-backup:local').text, 'Offline');
});
