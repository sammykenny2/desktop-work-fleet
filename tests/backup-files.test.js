import test from 'node:test';
import assert from 'node:assert/strict';
import { browserBackupFiles, saveBackupToHandle } from '../src/backup/browser-files.js';

function handleFixture({ fail, corrupt, onWrite, onClose } = {}) {
  const chunks = []; const events = [];
  const handle = {
    createWritable: async () => {
      events.push('open'); if (fail === 'open') throw new Error('open failed');
      return {
        write: async bytes => { events.push('write'); if (fail === 'write') throw new Error('write failed'); chunks.push(bytes.slice()); onWrite?.(); },
        close: async () => { events.push('close'); if (fail === 'close') throw new Error('close failed'); onClose?.(); },
        abort: async () => { events.push('abort'); },
      };
    },
    getFile: async () => {
      events.push('read'); if (fail === 'read') throw new Error('read failed');
      if (corrupt === 'size') return new Blob([]);
      if (corrupt === 'bytes') chunks[0][0] ^= 1;
      return new Blob(chunks);
    },
  };
  return { handle, events, bytes: async () => new Uint8Array(await new Blob(chunks).arrayBuffer()) };
}

test('confirmed file saving owns the supplied bytes, writes bounded chunks and reads back after close', async () => {
  const fixture = handleFixture(); const bytes = new Uint8Array(2 * 1024 * 1024 + 1); bytes[0] = 73;
  const operation = saveBackupToHandle(fixture.handle, { bytes }); bytes.fill(9);
  const result = await operation;
  assert.equal(result.saved, true); assert.match(result.receipt, /^[0-9a-f-]{36}$/);
  assert.deepEqual(fixture.events, ['open', 'write', 'write', 'write', 'close', 'read']);
  const saved = await fixture.bytes(); assert.equal(saved[0], 73); assert.equal(saved[1], 0); assert.equal(saved.length, bytes.length);
});

test('open/write/close/read failures and changed readback never produce a saved receipt', async () => {
  for (const fail of ['open', 'write', 'close', 'read']) {
    const fixture = handleFixture({ fail });
    await assert.rejects(saveBackupToHandle(fixture.handle, { bytes: new Uint8Array([2, 4, 6]) }),
      ['close', 'read'].includes(fail) ? error => error.code === 'backup-save-unconfirmed' : new RegExp(`${fail} failed`));
    if (['write', 'close'].includes(fail)) assert.equal(fixture.events.at(-1), 'abort');
  }
  for (const corrupt of ['size', 'bytes']) {
    const fixture = handleFixture({ corrupt });
    await assert.rejects(saveBackupToHandle(fixture.handle, { bytes: new Uint8Array([2, 4, 6]) }), error => error.code === 'backup-save-integrity');
  }
});

test('cancellation before open or during writes cannot confirm a safety backup', async () => {
  for (const stage of ['before', 'write']) {
    const controller = new AbortController();
    const fixture = handleFixture({ onWrite: () => { if (stage === 'write') controller.abort(); } });
    if (stage === 'before') controller.abort();
    await assert.rejects(saveBackupToHandle(fixture.handle, { bytes: new Uint8Array([1]), signal: controller.signal }), error => error.code === 'backup-cancelled');
    assert.equal(fixture.events.includes('read'), false);
    if (stage === 'before') assert.deepEqual(fixture.events, []);
    if (stage === 'write') assert.deepEqual(fixture.events, ['open', 'write', 'abort']);
  }
});

test('once close starts, late cancellation finishes file readback and returns the actual saved result', async () => {
  const controller = new AbortController(); const phases = [];
  const fixture = handleFixture({ onClose: () => controller.abort() });
  const result = await saveBackupToHandle(fixture.handle, { bytes: new Uint8Array([7, 8, 9]), signal: controller.signal,
    progress: value => phases.push(value.phase) });
  assert.equal(controller.signal.aborted, true); assert.equal(result.saved, true);
  assert.deepEqual(fixture.events, ['open', 'write', 'close', 'read']); assert.deepEqual(phases, ['save', 'save-commit']);
  assert.deepEqual(await fixture.bytes(), new Uint8Array([7, 8, 9]));
});

test('picker runs synchronously on destination request; unsupported downloads cannot authorize replacement', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'showSaveFilePicker');
  try {
    delete globalThis.showSaveFilePicker;
    const fallback = browserBackupFiles(); assert.equal(fallback.canConfirmSave, false);
    await assert.rejects(fallback.chooseDestination({ requireConfirmed: true }), error => error.code === 'backup-save-unavailable');
    const fixture = handleFixture(); let options;
    globalThis.showSaveFilePicker = async value => { options = value; return fixture.handle; };
    const files = browserBackupFiles(); assert.equal(files.canConfirmSave, true);
    const request = files.chooseDestination({ suggestedName: 'example.zip', requireConfirmed: true });
    assert.equal(options.suggestedName, 'example.zip'); assert.deepEqual(fixture.events, []);
    const destination = await request; assert.equal((await destination.save({ bytes: new Uint8Array([5]) })).saved, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'showSaveFilePicker', previous); else delete globalThis.showSaveFilePicker;
  }
});
