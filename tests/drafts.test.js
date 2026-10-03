import test from 'node:test';
import assert from 'node:assert/strict';
import { Drafts } from '../src/web/model.js';
class Disk {
  map = new Map();
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i]; }
  setItem(k, v) { this.map.set(k, v); }
  getItem(k) { return this.map.get(k) ?? null; }
  removeItem(k) { this.map.delete(k); }
}
const snapshot = { epoch: 'first-epoch' };
const note = { id: 'note', text: 'original', board: 'Inbox', status: 'todo', revision: 2 };
test('unsent edit survives a closed tab and does not absorb newer server content', () => {
  const disk = new Disk(); const client = new Drafts(disk);
  const draft = client.edit(client.create(snapshot, note), { text: 'my offline draft' });
  const reopened = new Drafts(disk).list()[0];
  assert.deepEqual(reopened, draft);
  assert.equal(reopened.original.text, 'original');
  assert.equal(reopened.revision, 2);
});
test('lost response reuses exact request after browser restart', () => {
  const disk = new Disk(); const client = new Drafts(disk);
  const draft = client.prepare(client.edit(client.create(snapshot), { text: 'new thought' }));
  const reboot = new Drafts(disk); const retry = reboot.prepare(reboot.list()[0]);
  assert.deepEqual(retry.pending, draft.pending);
  assert.throws(() => reboot.edit(retry, { text: 'changed after send' }));
});
test('independent tabs preserve both drafts', () => {
  const disk = new Disk(); const a = new Drafts(disk); const b = new Drafts(disk);
  a.edit(a.create(snapshot, note), { text: 'A' }); b.edit(b.create(snapshot, note), { text: 'B' });
  assert.deepEqual(a.list().map(x => x.text), ['A', 'B']);
});
test('conflict and restored epoch copy keep original recoverable', () => {
  const client = new Drafts(new Disk());
  const draft = client.prepare(client.edit(client.create(snapshot, note), { text: 'losing draft' }));
  const copy = client.copy(draft, 'restored-epoch');
  assert.equal(client.list().length, 2);
  assert.equal(copy.epoch, 'restored-epoch'); assert.equal(copy.revision, null);
  assert.equal(copy.text, draft.text); assert.notEqual(copy.id, draft.id);
  assert.equal(copy.pending, null); assert.equal(draft.epoch, 'first-epoch');
});
test('quota/disk failure stops preparation before transmission', () => {
  const disk = new Disk(); const client = new Drafts(disk);
  const draft = client.edit(client.create(snapshot), { text: 'keep me' });
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => client.prepare(draft), /quota/);
  assert.equal(client.list()[0].pending, null);
  assert.equal(client.list()[0].text, 'keep me');
});
test('delete and restore operations persist exact revision and retry identity', () => {
  const client = new Drafts(new Disk()); const deletion = client.action(snapshot, note, 'delete');
  assert.equal(deletion.pending.revision, 2); assert.equal(deletion.pending.action, 'delete');
  assert.deepEqual(client.prepare(deletion).pending, deletion.pending);
});
test('two tabs recovering one draft never overwrite or delete each other', () => {
  const disk = new Disk(); const a = new Drafts(disk); const b = new Drafts(disk);
  const original = a.edit(a.create(snapshot, note), { text: 'original draft' });
  const first = a.edit(a.recover(original), { text: 'A recovered edit' });
  const second = b.edit(b.recover(original), { text: 'B recovered edit' });
  const sent = a.prepare(first); a.remove(sent);
  assert.deepEqual(b.list().map(x => x.text), ['original draft', 'B recovered edit']);
  assert.notEqual(first.key, second.key);
});
test('first failed save still has a complete recoverable memory draft', () => {
  const disk = new Disk(); const client = new Drafts(disk);
  const draft = { ...client.blank(snapshot), text: 'first keystroke' };
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => client.write(draft), /quota/);
  assert.equal(draft.text, 'first keystroke'); assert.ok(draft.key);
  delete disk.setItem; client.write(draft);
  assert.equal(client.list()[0].text, 'first keystroke');
});
