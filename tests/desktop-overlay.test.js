import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayMainStep } from '../src/desktop/overlay.js';

const idle = { adjusting: false, aside: false };

test('a focused main window steps aside for the adjust overlay and comes back after it', () => {
  const start = overlayMainStep(idle, true, true);
  assert.deepEqual(start, { state: { adjusting: true, aside: true }, visible: false });
  assert.deepEqual(overlayMainStep(start.state, true, false), { state: start.state, visible: null }, 'later frames do not move it again');
  assert.deepEqual(overlayMainStep(start.state, false, false), { state: idle, visible: true });
});

test('a main window without the focus, such as a minimized one, is left alone and not brought back', () => {
  const start = overlayMainStep(idle, true, false);
  assert.deepEqual(start, { state: { adjusting: true, aside: false }, visible: null });
  assert.deepEqual(overlayMainStep(start.state, false, true), { state: idle, visible: null });
  assert.deepEqual(overlayMainStep(idle, false, true), { state: idle, visible: null });
});
