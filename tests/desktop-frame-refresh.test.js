import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameRefresher } from '../src/desktop/frame-refresh.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('ending a drag waits for the newer frame even while an older frame is still downloading', async () => {
  const oldFrame = deferred(), newFrame = deferred(), oldStarted = deferred(), newStarted = deferred();
  let reads = 0, complete = false;
  const refresh = createFrameRefresher(async () => {
    if (++reads === 1) { oldStarted.resolve(); await oldFrame.promise; }
    else { newStarted.resolve(); await newFrame.promise; }
  });
  const first = refresh(); await oldStarted.promise;
  const endDrag = refresh().then(() => { complete = true; });
  oldFrame.resolve(); await newStarted.promise;
  assert.equal(complete, false); assert.equal(reads, 2);
  newFrame.resolve(); await Promise.all([first, endDrag]); assert.equal(complete, true);
});

test('frame notifications coalesce while pending and a failed read permits a later retry', async () => {
  const gate = deferred(), started = deferred(); let reads = 0;
  const refresh = createFrameRefresher(async () => {
    if (++reads === 1) { started.resolve(); await gate.promise; throw new Error('frame download failed'); }
  });
  const failed = refresh(); await started.promise;
  assert.equal(refresh(), failed); assert.equal(refresh(), failed);
  const rejection = assert.rejects(failed, /frame download failed/); gate.resolve(); await rejection;
  await refresh(); assert.equal(reads, 2);
});
