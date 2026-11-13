import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { MemoryRecordStore } from '../src/storage/records.js';
import { WorkspaceRecordStorage } from '../src/storage/workspace-records.js';
import { DatasetSync } from '../src/sources/dataset-sync.js';
import { DatasetTestProvider } from './fixtures/dataset/provider.js';

// ADR-064: a pass talks to Drive outside the app's action queue and lands what it pulled inside it.
const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [] });
const heldAt = () => { let open, reached; const opened = new Promise(resolve => { open = resolve; }); const entered = new Promise(resolve => { reached = resolve; }); return { open, reached, opened, entered }; };

/** One device on a shared synthetic Drive; `queue` stands in for DesktopOwner.perform, which runs one action at a time. */
async function device(provider, deviceId) {
  const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), 'google:test');
  const workspace = await Workspace.create({ profileId: 'google:test', deviceId, area, current: true, bootstrapGroup: false,
    persist: (...args) => storage.save(...args) });
  const f = { provider, storage, workspace, inTurn: 0, turns: [], requests: [], outsideTurn: [], tail: Promise.resolve() };
  f.queue = action => {
    const next = f.tail.then(async () => { f.inTurn++; try { return await action(); } finally { f.inTurn--; } });
    f.tail = next.catch(() => {}); return next;
  };
  f.land = receive => f.queue(async () => { const value = await receive(); f.turns.push(f.workspace.syncState.cursor); return value; });
  const counted = new Proxy(provider, { get(target, key) {
    const value = Reflect.get(target, key, target);
    return typeof value !== 'function' ? value : (...args) => {
      f.requests.push({ method: String(key), inTurn: f.inTurn });
      return value.apply(target, args);
    };
  } });
  f.sync = new DatasetSync({ workspace, storage, fileStore: counted });
  f.pass = (options = {}) => f.sync.sync({ land: f.land, ...options });
  await f.pass(); await f.pass();
  return f;
}
const drain = async f => { let passes = 0; while (f.workspace.pendingCount && passes++ < 8) await f.pass({ force: true }); await f.pass({ force: true }); };

test('no provider request of a pass runs inside a queue turn, and every pull lands inside one', async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  await b.workspace.createCard(content('from the other device')); await drain(b);
  await a.workspace.createCard(content('mine'));
  a.requests.length = 0; a.turns.length = 0;
  await a.pass({ force: true });
  assert.ok(a.requests.length > 20, 'the pass must have talked to the provider');
  assert.deepEqual(a.requests.filter(request => request.inTurn), [], 'Drive must answer outside the queue');
  assert.equal(a.turns.length, 2, 'a pass with an upload pulls twice and lands each pull');
  assert.equal(a.workspace.pendingCount, 0);
  assert.ok(a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'));
});

test('an empty check lands nothing, so it takes no queue turn at all', async () => {
  const f = await device(new DatasetTestProvider(), 'a');
  f.turns.length = 0; f.requests.length = 0;
  const result = await f.pass();
  assert.equal(result.unchanged, true);
  assert.deepEqual(f.turns, []);
  assert.equal(f.requests.length, 1);
});

test('local work runs during a held Drive request, and the landing waits for a turn already taken', async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  await b.workspace.createCard(content('from the other device')); await drain(b);
  const held = heldAt(); let once = true;
  provider.hook = async point => { if (once && point === 'changes') { once = false; held.reached(); await held.opened; } };
  const pass = a.pass({ force: true }); await held.entered;

  // The queue is free while Drive has not answered.
  const saved = await a.queue(() => a.workspace.createCard(content('saved while Drive had not answered')));
  assert.equal(a.workspace.snapshot.cards.find(card => card.id === saved.id)?.content.text, 'saved while Drive had not answered');

  // An action holding the queue keeps the landing out until it ends.
  const action = heldAt();
  const holding = a.queue(async () => { action.reached(); await action.opened; return a.workspace.snapshot.cards.length; });
  await action.entered; held.open();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(!a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'), 'nothing may land under a running action');
  action.open(); assert.equal(await holding, 1, 'the action saw one state from start to end');
  await pass; provider.hook = async () => {};
  assert.ok(a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'));
  assert.ok(a.workspace.snapshot.cards.some(card => card.id === saved.id), 'a landing keeps what was saved under it');
});

test('saves made while a pass is uploading survive its landings and reach the other device', async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  const first = await a.workspace.createCard(content('first'));
  await b.workspace.createCard(content('from the other device')); await drain(b);
  const held = heldAt(); let once = true;
  provider.hook = async point => { if (once && point === 'create-before') { once = false; held.reached(); await held.opened; } };
  const pass = a.pass({ force: true }); await held.entered;

  // The pass has already read its queue: one new note and one edit of the note it is uploading right now.
  const read = a.workspace.pendingCount;
  const added = await a.workspace.createCard(content('added during the upload'));
  const edited = await a.workspace.updateCard(first.id, { content: content('first, edited during its upload') }, first.revision);
  assert.equal(a.workspace.pendingCount, read + 2);
  held.open(); await pass; provider.hook = async () => {};

  const shown = id => a.workspace.snapshot.cards.find(card => card.id === id);
  assert.equal(shown(added.id).content.text, 'added during the upload');
  assert.equal(shown(first.id).revision, edited.revision, 'the landing must not replace the edit with the version being uploaded');
  assert.equal(a.workspace.state.conflicts.length, 0);
  assert.equal(a.workspace.pendingCount, 2, 'what the pass had not read waits for the next one');
  assert.ok(a.workspace.syncState.localHeads.includes(added.revision));
  assert.ok(a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'));

  await drain(a); await drain(b);
  assert.equal(a.workspace.pendingCount, 0);
  assert.deepEqual(b.workspace.snapshot.cards.map(card => card.content.text).sort(),
    ['added during the upload', 'first, edited during its upload', 'from the other device']);
  assert.equal(b.workspace.state.conflicts.length, 0);
});

for (const endSession of [true, false]) test(`a pass stopped while waiting for its turn lands nothing and still ends (endSession ${endSession})`, async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  await b.workspace.createCard(content('from the other device')); await drain(b);
  const action = heldAt();
  const holding = a.queue(async () => { action.reached(); await action.opened; });
  await action.entered;
  const before = a.workspace.syncState.cursor, landing = heldAt();
  const land = a.land;
  a.land = receive => { const pending = land(receive); landing.reached(); return pending; };
  const pass = a.pass({ force: true });
  await landing.entered;
  await a.sync.stop({ endSession });
  let idle = false; const whenIdle = a.sync.whenIdle().then(() => { idle = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(idle, false, 'the pass is still waiting for the queue turn the action holds');
  action.open(); await holding;
  await assert.rejects(pass, { code: 'stale-session' }); await whenIdle;
  assert.equal(a.workspace.syncState.cursor, before, 'a stopped pass must not move the cursor');
  assert.ok(!a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'), 'a stopped pass must not land');
});

test('a failed landing fails the pass and keeps the cursor, so the next pass lands it again', async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  await b.workspace.createCard(content('from the other device')); await drain(b);
  const before = a.workspace.syncState.cursor;
  const failure = Object.assign(new Error('Synthetic queue failure'), { code: 'desktop-closing' });
  await assert.rejects(a.sync.sync({ force: true, land: () => Promise.reject(failure) }), { code: 'desktop-closing' });
  assert.equal(a.workspace.syncState.cursor, before);
  await a.pass({ force: true });
  assert.ok(a.workspace.snapshot.cards.some(card => card.content.text === 'from the other device'));
});

test('callers that pass no land keep landing directly, and `land` ends with its pass', async () => {
  const provider = new DatasetTestProvider(), a = await device(provider, 'a'), b = await device(provider, 'b');
  await b.workspace.createCard(content('one')); await drain(b);
  a.turns.length = 0;
  await a.sync.sync({ force: true });
  assert.ok(a.workspace.snapshot.cards.some(card => card.content.text === 'one'));
  assert.deepEqual(a.turns, []);
  await b.workspace.createCard(content('two')); await drain(b);
  await a.pass({ force: true }); assert.equal(a.turns.length, 1);
  await b.workspace.createCard(content('three')); await drain(b);
  await a.sync.sync({ force: true }); assert.equal(a.turns.length, 1, 'a later pass must not inherit an earlier caller\'s land');
});
