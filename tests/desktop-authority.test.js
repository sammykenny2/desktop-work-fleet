import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { InteractionController } from '../src/interaction/controller.js';
import { DesktopAuthority } from '../src/desktop/authority.js';
import { projectDesktop } from '../src/desktop/projection.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const uuid = () => crypto.randomUUID();
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture() {
  let fail = false; let durable; let flush = async () => {}; let editor = null;
  const workspace = await Workspace.create({ profileId: 'local', deviceId: uuid(), area,
    persist: async value => { if (fail) throw new Error('disk full'); durable = structuredClone(value); } });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('另一組');
  const card = await workspace.createCard({ format: 'markdown', text: '# 第一件事', attachments: [] }, a.id);
  const other = await workspace.createCard({ format: 'markdown', text: '第二件事', attachments: [] }, b.id);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout, commands: workspace,
    saveDraft: () => flush() });
  const sessionId = uuid(); const view = uuid(); const foreign = uuid();
  const authority = new DesktopAuthority({ workspace, controller, sessionId, details: async id => ({ cardId: id }), editor: {
    current: () => editor && structuredClone(editor),
    begin: async (id, viewId) => {
      if (!await controller.beginEdit(id, { gesture: true })) return null;
      const current = workspace.snapshot.cards.find(value => value.id === id);
      const draft = workspace.blankDraft(current.groupId, current); await workspace.saveDraft(draft);
      editor = { cardId: id, draftId: draft.id, viewId, text: draft.content.text, sequence: 0 }; return structuredClone(editor);
    },
    change: async value => {
      const draft = workspace.state.drafts[value.draftId]; draft.content.text = value.text;
      await workspace.saveDraft(draft); editor = structuredClone(value);
    },
    save: async () => { await workspace.commitDraft(editor.draftId); await controller.endEdit(); editor = null; },
    end: async () => { await controller.endEdit(); editor = null; },
    full: async () => ({ draftId: editor.draftId }),
  } });
  authority.addView(view); authority.addView(foreign);
  let serial = 0;
  const envelope = (method, args = {}) => ({ sessionId, id: uuid(), serial: ++serial, method, args });
  const command = (method, args = {}, source = view) => authority.request(source, envelope(method, args));
  const frame = () => projectDesktop({ snapshot: workspace.snapshot, layout: workspace.layout.state, interaction: controller.state,
    sessionId, sequence: 1, workspaceRevision: workspace.state.revision, editor });
  return { workspace, controller, authority, card, other, a, b, view, foreign, sessionId, command, envelope, frame,
    editor: () => editor, durable: () => durable, fail: value => { fail = value; }, flush: value => { flush = value; } };
}

test('desktop projection separates resident policy, temporary floating and content from historical authority', async () => {
  const f = await fixture(); const before = f.workspace.state;
  let frame = f.frame();
  assert.ok(frame.cards.every(card => !card.interactive && card.layer === 'desktop'));
  for (const field of ['revisions', 'outbox', 'drafts', 'sync', 'restoreReceipts']) assert.equal(Object.hasOwn(frame, field), false);
  await f.controller.activate({ kind: 'group', groupId: f.a.id }); frame = f.frame();
  assert.equal(frame.cards.find(c => c.id === f.card.id).layer, 'floating');
  assert.equal(frame.cards.find(c => c.id === f.other.id).interactive, false);
  assert.deepEqual(f.workspace.state, before);
  frame.cards[0].rect.x += 500; assert.deepEqual(f.workspace.state, before);
  await f.workspace.layout.setCardPolicy(f.other.id, { residentLayer: 'wallpaper', readOnlySelect: true });
  frame = f.frame();
  assert.deepEqual(frame.fallbacks, [{ cardId: f.other.id, requested: 'wallpaper', effective: 'desktop' }]);
  assert.equal(frame.cards.find(c => c.id === f.other.id).interactive, true);
  assert.equal(f.workspace.layout.state.placements[f.other.id].residentLayer, 'wallpaper');
  await f.workspace.layout.setCardPolicy(f.card.id, { visible: false });
  assert.equal(f.frame().cards.some(c => c.id === f.card.id), false);
});

test('desktop gesture owns one view and commits one move despite a duplicate pointer-up receipt', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const gestureId = uuid(); const args = { gestureId, pointerId: 4 }; const original = f.workspace.layout.state.placements[f.card.id];
  await f.command('pointer.down', { ...args, cardId: f.card.id, point: { x: 100, y: 100 } });
  await rejects(f.command('pointer.move', { ...args, point: { x: 700, y: 700 } }, f.foreign), 'desktop-gesture');
  await f.command('pointer.move', { ...args, point: { x: 130, y: 145 } });
  assert.equal(f.frame().cards.find(c => c.id === f.card.id).rect.x, original.x + 30);
  assert.equal(f.workspace.layout.state.placements[f.card.id].x, original.x);
  const up = f.envelope('pointer.up', { ...args, point: { x: 130, y: 145 } });
  const [first, repeated] = await Promise.all([f.authority.request(f.view, up), f.authority.request(f.view, up)]);
  assert.deepEqual(first, repeated); assert.equal(first.kind, 'moved');
  assert.equal(f.workspace.layout.state.history.length, 1);
  assert.equal(f.workspace.layout.state.placements[f.card.id].x, original.x + 30);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.card.id).groupId, f.a.id);
  await rejects(f.authority.request(f.view, { ...up, args: { ...up.args, point: { x: 0, y: 0 } } }), 'desktop-replay');
});

test('desktop transfer uses shared atomic command; save failure leaves original placement and membership', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const before = f.workspace.state; f.fail(true);
  await assert.rejects(f.command('card.transfer', { cardId: f.card.id, groupId: f.b.id }), /disk full/);
  assert.deepEqual(f.workspace.state, before); f.fail(false);
  await f.command('card.transfer', { cardId: f.card.id, groupId: f.b.id });
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.card.id).groupId, f.b.id);
  assert.deepEqual(f.workspace.layout.state.placements[f.card.id], before.layout.placements[f.card.id]);
  await f.workspace.undo([area]); assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.card.id).groupId, f.a.id);
});

test('read-only selectable desktop text does not grant editing or card commands', async () => {
  const f = await fixture(); await f.workspace.layout.setCardPolicy(f.card.id, { readOnlySelect: true });
  assert.equal(f.frame().cards.find(c => c.id === f.card.id).interactive, true);
  await rejects(f.command('card.edit', { cardId: f.card.id }), 'outside-scope');
  await rejects(f.command('card.transfer', { cardId: f.card.id, groupId: f.b.id }), 'outside-scope');
  assert.equal(f.editor(), null);
});

test('desktop draft acknowledgement follows durable save and enforces view, identity and text sequence', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const draft = await f.command('card.edit', { cardId: f.card.id });
  const update = { draftId: draft.draftId, sequence: 1, text: '中文尚未提交' };
  await rejects(f.command('editor.change', update, f.foreign), 'desktop-editor');
  f.fail(true); await assert.rejects(f.command('editor.change', update), /disk full/);
  assert.equal(f.editor().sequence, 0); f.fail(false);
  await f.command('editor.change', update);
  assert.equal(f.durable().drafts[draft.draftId].content.text, update.text);
  await f.command('editor.change', update); // New transport request after an unknown acknowledgement outcome.
  await rejects(f.command('editor.change', { ...update, text: '遲到的其他文字' }), 'desktop-edit-order');
  await rejects(f.command('editor.change', { ...update, sequence: 3 }), 'desktop-edit-order');
  await rejects(f.command('editor.save', { draftId: draft.draftId, sequence: 0 }), 'desktop-editor');
  await f.command('editor.save', { draftId: draft.draftId, sequence: 1 });
  assert.equal(f.editor(), null); assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.card.id).content.text, update.text);
});

test('flush barrier can receive its last draft write while the owner is awaiting edit exit', { timeout: 2000 }, async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const draft = await f.command('card.edit', { cardId: f.card.id }); const barrier = deferred(); const requested = deferred();
  f.flush(async () => { requested.resolve(); await barrier.promise; });
  const exit = f.command('editor.end', { draftId: draft.draftId, sequence: 0 }); await requested.promise;
  const crowded = Array.from({ length: 23 }, () => f.command('card.select', { cardId: f.other.id }));
  await f.command('editor.change', { draftId: draft.draftId, sequence: 1, text: '退出前最後輸入' });
  barrier.resolve(); await exit;
  await Promise.all(crowded);
  assert.equal(f.editor(), null); assert.equal(f.workspace.state.drafts[draft.draftId].content.text, '退出前最後輸入');
});

test('evicted receipts reject replay and an owner scope change releases the previous gesture', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const transfer = f.envelope('card.transfer', { cardId: f.card.id, groupId: f.b.id });
  await f.authority.request(f.view, transfer); await f.workspace.undo([area]);
  for (let i = 0; i < 258; i++) await f.command('card.select', { cardId: f.card.id });
  const before = f.workspace.state;
  assert.throws(() => f.authority.request(f.view, transfer), error => error.code === 'desktop-expired');
  assert.deepEqual(f.workspace.state, before);
  const down = () => f.command('pointer.down', { gestureId: uuid(), pointerId: 4, cardId: f.card.id, point: { x: 10, y: 10 } });
  await down(); await f.controller.activate({ kind: 'none' }); await f.controller.activate({ kind: 'all' });
  assert.equal((await down()).accepted, true);
});

test('an end command waits for earlier admitted draft writes before validating its editor sequence', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const draft = await f.command('card.edit', { cardId: f.card.id });
  const update = f.command('editor.change', { draftId: draft.draftId, sequence: 1, text: '最後已接收的文字' });
  const end = f.command('editor.end', { draftId: draft.draftId, sequence: 0 });
  await update; await rejects(end, 'desktop-editor');
  assert.equal(f.editor().sequence, 1); assert.equal(f.controller.state.editingCardId, f.card.id);
  await f.command('editor.end', { draftId: draft.draftId, sequence: 1 }); assert.equal(f.editor(), null);
});

test('retired views and old owner sessions cannot run queued commands or reuse view identity', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  assert.throws(() => f.authority.request(f.view, { ...f.envelope('card.select'), sessionId: uuid() }), error => error.code === 'desktop-command');
  const queued = f.command('card.select', { cardId: f.card.id }); f.authority.removeView(f.view);
  await rejects(queued, 'desktop-view'); assert.equal(f.controller.state.selectedCardId, null);
  assert.throws(() => f.authority.addView(f.view), error => error.code === 'desktop-view');
  assert.throws(() => f.authority.addView(uuid() + '\n'), error => error.code === 'desktop-view');
  f.authority.close();
  assert.throws(() => f.command('card.select', { cardId: f.other.id }, f.foreign), error => error.code === 'desktop-view');
});

test('cancelled native view releases the owned pointer without committing preview geometry', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' }); const before = f.workspace.state;
  const gestureId = uuid(); const args = { gestureId, pointerId: 8 };
  await f.command('pointer.down', { ...args, cardId: f.card.id, point: { x: 20, y: 20 } });
  await f.command('pointer.move', { ...args, point: { x: 600, y: 500 } });
  f.authority.removeView(f.view);
  assert.equal(f.controller.state.dragSession, null); assert.deepEqual(f.workspace.state, before);
});

test('a delayed view gesture cannot commit or cancel a replacement main-window drag with the same pointer id', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const gestureId = uuid(); const args = { gestureId, pointerId: 1 };
  await f.command('pointer.down', { ...args, cardId: f.card.id, point: { x: 10, y: 10 } });
  f.controller.cancelDrag(); f.controller.pointerDown(f.card.id, { x: 100, y: 100 }, { pointerId: 1 });
  const replacement = f.controller.state.dragSession;
  await rejects(f.command('pointer.up', { ...args, point: { x: 40, y: 40 } }), 'desktop-gesture');
  f.authority.removeView(f.view);
  assert.deepEqual(f.controller.state.dragSession, replacement); assert.equal(f.workspace.layout.state.history.length, 0);
});
