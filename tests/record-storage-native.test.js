import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetError } from '../src/core/contracts.js';
import { sha256 } from '../src/sources/files.js';
import { MemoryRecordStore, recordTransaction } from '../src/storage/records.js';
import { NativeRecordStore } from '../src/storage/records-native.js';

function session() {
  const memory = new MemoryRecordStore(); const transfers = new Map(); const stages = new Map();
  let loseReply = false, wrongReceipt = false, failBefore = false; const uploads = [];
  const download = async (value, raw = false) => {
    if (value === null) return null;
    const bytes = raw ? value : new TextEncoder().encode(JSON.stringify(value)); const token = crypto.randomUUID(); transfers.set(token, bytes);
    return { token, size: bytes.length, sha256: await sha256(bytes) };
  };
  const bridge = { async request(method, args = {}) {
    switch (method) {
      case 'transfer.begin': { const token = crypto.randomUUID(); transfers.set(token, new Uint8Array(args.size)); uploads.push(args.size); return { token }; }
      case 'transfer.append': { const bytes = Uint8Array.from(atob(args.base64), char => char.charCodeAt(0)); transfers.get(args.token).set(bytes, args.offset); return { offset: args.offset + bytes.length }; }
      case 'transfer.finish': { const token = crypto.randomUUID(); stages.set(token, transfers.get(args.token)); return { token }; }
      case 'transfer.discard': transfers.delete(args.token); stages.delete(args.token); return null;
      case 'transfer.read': {
        const bytes = transfers.get(args.token); const chunk = bytes.subarray(args.offset, args.offset + 256 * 1024);
        return { offset: args.offset, base64: Buffer.from(chunk).toString('base64'), done: args.offset + chunk.length === bytes.length };
      }
      case 'storage.records.commit': {
        if (failBefore) throw new FleetError('native-outcome-unknown', 'Synthetic request timeout');
        const value = JSON.parse(new TextDecoder().decode(stages.get(args.token)));
        const attachments = await Promise.all(args.attachments.map(async token => ({ id: await sha256(stages.get(token)), bytes: stages.get(token) })));
        const result = await memory.commit(value, args.expectedRevision, { attachments });
        if (loseReply) throw new FleetError('native-outcome-unknown', 'Synthetic reply loss');
        return result;
      }
      case 'storage.records.status': {
        const result = await memory.status('local'); return wrongReceipt && result ? { ...result, commitId: crypto.randomUUID() } : result;
      }
      case 'storage.records.get': return download(await memory.get('local', args.collection, args.key));
      case 'storage.records.page': return download(await memory.page('local', args));
      case 'storage.attachment': {
        const blob = await memory.getAttachment('local', args.id);
        return download(blob === null ? null : new Uint8Array(await blob.arrayBuffer()), true);
      }
      default: throw new Error(`Unexpected test method ${method}`);
    }
  } };
  const storage = new NativeRecordStore(bridge, { profileId: 'local', maxRecordBytes: 128 * 1024 * 1024, maxAttachmentBytes: 25 * 1024 * 1024 });
  return { storage, transfers, stages, uploads, lose: () => { loseReply = true; }, corrupt: () => { wrongReceipt = true; }, fail: () => { failBefore = true; } };
}

test('native record adapter resolves a lost acknowledgement using the exact small receipt', async () => {
  const host = session(); host.lose();
  const transaction = recordTransaction('local', null, [{ collection: 'draft', key: 'one', entity: 'card:one', ordinal: 0, value: { text: 'saved' } }]);
  const bytes = new TextEncoder().encode('atomic attachment'); const id = await sha256(bytes);
  const receipt = await host.storage.commit(transaction, null, { attachments: [{ id, bytes }] });
  assert.equal(receipt.commitId, transaction.commitId);
  assert.equal((await host.storage.get('local', 'draft', 'one')).value.text, 'saved');
  assert.equal((await host.storage.page('local', { collection: 'draft', expectedRevision: 0 })).rows.length, 1);
  assert.equal(await (await host.storage.getAttachment('local', id)).text(), 'atomic attachment');
  assert.equal(host.transfers.size, 0); assert.equal(host.stages.size, 0);
  assert.ok(host.uploads[0] < 1024);
});

test('native record adapter never infers commit success from a revision alone or a timeout before commit', async () => {
  for (const mode of ['corrupt', 'fail']) {
    const host = session(); host.lose(); host[mode]();
    await assert.rejects(host.storage.commit(recordTransaction('local', null), null), { code: 'native-outcome-unknown' });
    assert.equal(host.transfers.size, 0); assert.equal(host.stages.size, 0);
  }
  const host = session();
  await assert.rejects(host.storage.status('google:another'), { code: 'invalid-profile' });
  await assert.rejects(host.storage.commit(recordTransaction('google:another', null), null), { code: 'invalid-profile' });
  assert.deepEqual(host.uploads, []);
});
