import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// A desktop host runs actions one at a time, and an action that waits for a later one waits for ever. Browser probes have
// no such host, so this runs the page's move code on the same strict queue.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const from = source.indexOf('// Moving across (ADR-066)'); const to = source.indexOf('// A note from a group that has moved away needs another group;');
assert.ok(from > 0 && to > from);
const runStart = source.indexOf('async function run(action'); const runEnd = source.indexOf('function primaryArea(workAreas)');
assert.ok(runStart > 0 && runEnd > runStart);

function harness({ refuse = () => null, fail = () => null, moving = () => {} } = {}) {
  let tail = Promise.resolve(); const log = []; const buttons = new Map(); const shown = [];
  const node = () => ({ children: [], style: { setProperty() {} }, addEventListener() {},
    append(...items) { this.children.push(...items); }, showModal() { shown.push(this); }, close() { this.onclose?.(); }, remove() {} });
  const element = (tag, text, className) => { const made = node(); made.tag = tag; made.textContent = text; made.className = className; return made; };
  const groups = [{ id: 'group', name: 'Plans', profileId: 'google:a' }, { id: 'away', name: 'Home', profileId: 'local' }];
  const cards = [{ id: 'one', groupId: 'group', content: {} }, { id: 'two', groupId: 'group', content: {} }, { id: 'three', groupId: 'group', content: {} }];
  const owner = { id: 'google:a', workspace: { state: { groups }, working: { cards } } };
  const context = vm.createContext({
    console, Promise, Set, String, activeActions: new Set(), nativeClosing: false, syncBusy: false, maintenanceWork: false, syncRequested: false, activeGroupId: 'other', composing: false, currentDraft: null, log,
    document: { body: { append() {} } }, element, shown,
    immediateButton: (text, handler) => { const made = element('button', text); buttons.set(text, handler); return made; },
    t: key => key, plural: key => key, status: (text, isError) => log.push(isError ? `error:${text}` : `status:${text}`),
    sectionName: id => id, groupName: group => group?.name ?? '', summaryText: card => card.id, groupColor: () => '#fff', adjustOverlayActive: () => false, $: () => ({}),
    currentCard: id => cards.find(card => card.id === id), activeGroups: () => [],
    render: () => log.push('render'), rememberGroup: async () => {}, workAreas: () => [], syncGoogle: async () => {},
    controller: { state: { operationScope: { kind: 'none' } }, endEdit: async () => true, reconcile: async () => {} },
    workspace: { pendingCount: 0, working: { cards }, groups: () => groups, layout: { placeNew: async () => {} }, ownerOfCard: () => owner, ownerOfGroup: id => id === 'group' ? owner : { id: 'local' }, profile: () => ({ workspace: { snapshot: {} } }) },
    crossMove: { refusal: id => refuse(id), groupTarget: async () => null,
      moveNote: async id => { const error = fail(id); if (error) throw error; log.push(`move:${id}`); cards.find(card => card.id === id).deleted = true; moving(id); },
      openGroup: async () => { log.push('open'); return 'target'; }, finishGroup: async () => { log.push('finish'); return cards.every(card => card.deleted); } },
    desktop: { perform: action => { const next = tail.then(() => action()); tail = next.catch(() => {}); return next; } } });
  vm.runInContext(`${source.slice(runStart, runEnd)}\n${source.slice(from, to)}\nglobalThis.api = { run, askMoveNote, askMoveGroup };`, context);
  return { ...context.api, context, log, buttons, shown, queue: action => context.desktop.perform(action), idle: () => tail };
}
const settled = async (promise, message) => {
  let timer; const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 2000); });
  try { return await Promise.race([promise, late]); } finally { clearTimeout(timer); }
};
async function until(condition, message) {
  for (let attempt = 0; attempt < 400; attempt++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error(message);
}

test('confirming a note move finishes on a desktop queue', async () => {
  const f = harness();
  await settled(f.run(() => f.askMoveNote('one', 'away')), 'asking stopped the queue');
  f.buttons.get('app.move.confirmNote')();
  await until(() => f.log.includes('status:app.move.noteDone'), 'the move never finished: its steps wait for its own turn');
  assert.ok(f.log.includes('move:one'));
});

test('a note whose attachment cannot be fetched is refused with the reason', async () => {
  const f = harness({ fail: () => Object.assign(new Error('no bytes'), { code: 'move-attachment' }) });
  await f.run(() => f.askMoveNote('one', 'away'));
  f.buttons.get('app.move.confirmNote')();
  await until(() => f.shown.at(-1)?.children[0].textContent === 'app.move.refusedTitle', 'no reason was shown');
  assert.equal(f.shown.at(-1).children[1].textContent, 'no bytes');
  assert.equal(f.log.includes('status:app.move.noteDone'), false);
});

test('a group move finishes on a desktop queue, and something else gets a turn between its notes', async () => {
  // Another window asks for something while the first note moves.
  const f = harness({ moving: id => { if (id === 'one') void f.queue(() => f.log.push('other')); } });
  await settled(f.run(() => f.askMoveGroup('group', 'local')), 'asking stopped the queue');
  f.buttons.get('app.move.confirmGroup')();
  await until(() => f.log.includes('finish'), 'the move never finished: its notes wait for its own turn');
  await until(() => f.shown.at(-1)?.children[0].textContent === 'app.move.doneTitle', 'no result was shown');
  assert.deepEqual(f.log.filter(entry => entry.startsWith('move:') || entry === 'other'), ['move:one', 'other', 'move:two', 'move:three'], 'the queue must not be held for the whole group');
  assert.equal(f.context.activeActions.size, 0, 'closing the app no longer waits for it');
});

test('a note that cannot move stays behind and the others go on; other trouble ends the move', async () => {
  const blocked = Object.assign(new Error('no bytes'), { code: 'move-attachment' });
  const f = harness({ fail: id => id === 'two' ? blocked : null });
  await f.run(() => f.askMoveGroup('group', 'local'));
  f.buttons.get('app.move.confirmGroup')();
  await until(() => f.shown.at(-1)?.children[0].textContent === 'app.move.partialTitle', 'no result was shown');
  assert.deepEqual(f.log.filter(entry => entry.startsWith('move:')), ['move:one', 'move:three']);

  const g = harness({ fail: id => id === 'two' ? new Error('disk full') : null });
  await g.run(() => g.askMoveGroup('group', 'local'));
  g.buttons.get('app.move.confirmGroup')();
  await until(() => g.shown.at(-1)?.children[0].textContent === 'app.move.partialTitle', 'no result was shown');
  assert.deepEqual(g.log.filter(entry => entry.startsWith('move:')), ['move:one']);
});

test('stopping finishes the current note and moves no more', async () => {
  // Pressed while the first note moves.
  const f = harness({ moving: id => { if (id === 'one') f.buttons.get('app.move.stop')(); } });
  await f.run(() => f.askMoveGroup('group', 'local'));
  f.buttons.get('app.move.confirmGroup')();
  await until(() => f.shown.at(-1)?.children[0].textContent === 'app.move.stoppedTitle', 'no result was shown');
  assert.deepEqual(f.log.filter(entry => entry.startsWith('move:')), ['move:one']);
  assert.equal(f.context.activeActions.size, 0);
});

test('a group with nothing that can move says so and opens nothing', async () => {
  const f = harness({ refuse: () => 'conflict' });
  await f.run(() => f.askMoveGroup('group', 'local'));
  assert.equal(f.shown.at(-1).children[0].textContent, 'app.move.noneTitle');
  assert.equal(f.log.includes('open'), false);
});
