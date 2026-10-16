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
async function fixture(attachments) {
  let fail = false; let durable; let flush = async () => {}; let editor = null; let shortcutIntent; const arranged = [];
  const workspace = await Workspace.create({ profileId: 'local', deviceId: uuid(), area,
    persist: async value => { if (fail) throw new Error('disk full'); durable = structuredClone(value); } });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('另一組');
  const card = await workspace.createCard({ format: 'markdown', text: '# 第一件事', attachments: [] }, a.id);
  const other = await workspace.createCard({ format: 'markdown', text: '第二件事', attachments: [] }, b.id);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout, commands: workspace,
    saveDraft: () => flush() });
  const sessionId = uuid(); const view = uuid(); const foreign = uuid();
  const authority = new DesktopAuthority({ workspace, controller, sessionId, attachments, details: async id => ({ cardId: id }),
    arrange: async kind => { arranged.push(kind); return null; },
    shortcut: (target, intent) => { shortcutIntent = intent; return controller.activate(target === '@all' ? { kind: 'all' } : { kind: 'group', groupId: target }); }, editor: {
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
    editor: () => editor, shortcutIntent: () => shortcutIntent, arranged, durable: () => durable, fail: value => { fail = value; }, flush: value => { flush = value; } };
}

test('scene shortcuts resolve the current owner bindings and cannot supply a different target or reuse removed bindings', async () => {
  const f = await fixture(); const key = 'Ctrl+Shift+1';
  await f.workspace.layout.configure({ shortcuts: { [key]: f.a.id } }, f.workspace.snapshot);
  await f.command('interaction.shortcut', { key, target: f.b.id });
  assert.equal(f.controller.state.operationScope.groupId, f.a.id);
  await f.workspace.layout.configure({ shortcuts: { [key]: f.b.id } }, f.workspace.snapshot);
  await f.command('interaction.shortcut', { key }); assert.equal(f.controller.state.operationScope.groupId, f.b.id);
  await f.workspace.layout.configure({ shortcuts: {} }, f.workspace.snapshot);
  await rejects(f.command('interaction.shortcut', { key }), 'desktop-shortcut');
  assert.equal(f.controller.state.operationScope.groupId, f.b.id);
});

test('shortcut focus context is host metadata, not renderer arguments, and a retry never refreshes it', async () => {
  const f = await fixture(); const key = 'Ctrl+Shift+1'; const trusted = uuid();
  const command = f.envelope('interaction.shortcut', { key, intent: 'renderer-forgery' });
  const context = { intent: trusted }; const pending = f.authority.request(f.view, command, context); context.intent = uuid();
  await pending; assert.equal(f.shortcutIntent(), trusted);
  await f.authority.request(f.view, command, { intent: uuid() }); assert.equal(f.shortcutIntent(), trusted);
  await f.command('interaction.shortcut', { key, intent: trusted }); assert.equal(f.shortcutIntent(), null);
});

test('desktop projection separates resident policy, temporary floating and content from historical authority', async () => {
  const f = await fixture(); const before = f.workspace.state;
  let frame = f.frame();
  // Locked desktop papers take clicks and text selection but cannot be dragged.
  assert.ok(frame.cards.every(card => card.interactive && !card.draggable && card.layer === 'desktop'));
  for (const field of ['revisions', 'outbox', 'drafts', 'sync', 'restoreReceipts']) assert.equal(Object.hasOwn(frame, field), false);
  await f.controller.activate({ kind: 'group', groupId: f.a.id }); frame = f.frame();
  assert.equal(frame.cards.find(c => c.id === f.card.id).layer, 'floating');
  assert.equal(frame.cards.find(c => c.id === f.other.id).draggable, false);
  assert.equal(frame.cards.find(c => c.id === f.other.id).layer, 'desktop');
  assert.deepEqual(f.workspace.state, before);
  frame.cards[0].rect.x += 500; assert.deepEqual(f.workspace.state, before);
  await f.workspace.layout.setGroupLayer(f.b.id, 'wallpaper', f.workspace.snapshot);
  frame = f.frame();
  assert.deepEqual(frame.fallbacks, [{ cardId: f.other.id, requested: 'wallpaper', effective: 'desktop' }]);
  assert.equal(frame.cards.find(c => c.id === f.other.id).interactive, false);
  assert.equal(f.workspace.layout.state.groupLayers[f.b.id], 'wallpaper');
  await f.workspace.layout.setCardPolicy(f.card.id, { visible: false });
  assert.equal(f.frame().cards.some(c => c.id === f.card.id), false);
});

test('wallpaper projections stay passive, float only their operated group, then restore current resident policy', async () => {
  const f = await fixture();
  await f.workspace.layout.setGroupLayer(f.a.id, 'wallpaper', f.workspace.snapshot);
  await f.workspace.layout.setGroupLayer(f.b.id, 'wallpaper', f.workspace.snapshot);
  const saved = structuredClone(f.workspace.layout.state.placements[f.card.id]);
  const project = () => projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state,
    interaction: f.controller.state, sessionId: 'wallpaper-test', sequence: 1, workspaceRevision: f.workspace.state.revision,
    layers: ['desktop', 'floating', 'wallpaper'] });
  let frame = project();
  assert.deepEqual(frame.fallbacks, []);
  assert.ok(frame.cards.every(card => card.layer === 'wallpaper' && !card.interactive && !card.draggable));
  await f.controller.activate({ kind: 'group', groupId: f.a.id });
  frame = project();
  assert.equal(frame.cards.find(card => card.id === f.card.id).layer, 'floating');
  assert.equal(frame.cards.find(card => card.id === f.card.id).draggable, true);
  assert.equal(frame.cards.find(card => card.id === f.other.id).layer, 'wallpaper');
  assert.equal(frame.cards.find(card => card.id === f.other.id).interactive, false);
  assert.deepEqual(f.workspace.layout.state.placements[f.card.id], saved);
  await f.controller.activate({ kind: 'none' });
  assert.ok(project().cards.every(card => card.layer === 'wallpaper' && !card.interactive));
  await f.controller.activate({ kind: 'all' });
  await f.workspace.layout.setGroupLayer(f.a.id, 'desktop', f.workspace.snapshot);
  await f.controller.activate({ kind: 'none' });
  assert.equal(project().cards.find(card => card.id === f.card.id).layer, 'desktop');
  assert.equal(project().cards.find(card => card.id === f.other.id).layer, 'wallpaper');
});

test('without a desktop layer, desktop papers rest on the wallpaper and the saved layer stays desktop', async () => {
  const f = await fixture();
  const project = layers => projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state,
    interaction: f.controller.state, sessionId: 'gnome-test', sequence: 1, workspaceRevision: f.workspace.state.revision, layers });
  let frame = project(['wallpaper', 'floating']);
  assert.deepEqual(frame.fallbacks.map(value => [value.requested, value.effective]), [['desktop', 'wallpaper'], ['desktop', 'wallpaper']]);
  assert.ok(frame.cards.every(card => card.layer === 'wallpaper' && !card.interactive && !card.draggable && !card.editing));
  assert.equal(f.workspace.layout.state.groupLayers[f.a.id], undefined, 'the saved preference is not rewritten');
  await f.controller.activate({ kind: 'group', groupId: f.a.id }); frame = project(['wallpaper', 'floating']);
  const operated = frame.cards.find(card => card.id === f.card.id);
  assert.deepEqual([operated.layer, operated.interactive, operated.draggable], ['floating', true, true]);
  assert.equal(frame.cards.find(card => card.id === f.other.id).layer, 'wallpaper');
  await f.controller.activate({ kind: 'none' });
  await f.workspace.layout.setGroupLayer(f.b.id, 'floating', f.workspace.snapshot);
  assert.deepEqual(project(['wallpaper', 'floating']).fallbacks.map(value => value.cardId), [f.card.id]);
  assert.throws(() => project(['floating']), error => error.code === 'desktop-layer');
});

test('a host whose topmost scene only carries adjusted papers rests every other paper on the wallpaper', async () => {
  const f = await fixture(); const layers = ['wallpaper', 'floating']; const residentLayers = ['wallpaper'];
  const project = (resident = residentLayers) => projectDesktop({ snapshot: f.workspace.snapshot, layout: f.workspace.layout.state,
    interaction: f.controller.state, sessionId: 'adjust-only', sequence: 1, workspaceRevision: f.workspace.state.revision, layers, residentLayers: resident });
  await f.workspace.layout.setGroupLayer(f.b.id, 'floating', f.workspace.snapshot);
  let frame = project();
  assert.deepEqual(Object.fromEntries(frame.fallbacks.map(value => [value.cardId, [value.requested, value.effective]])),
    { [f.card.id]: ['desktop', 'wallpaper'], [f.other.id]: ['floating', 'wallpaper'] });
  assert.ok(frame.cards.every(card => card.layer === 'wallpaper' && !card.interactive && !card.draggable));
  await f.controller.activate({ kind: 'group', groupId: f.b.id }); frame = project();
  const adjusted = frame.cards.find(card => card.id === f.other.id);
  assert.deepEqual([adjusted.layer, adjusted.interactive, adjusted.draggable], ['floating', true, true], 'adjust mode still uses the topmost scene');
  assert.deepEqual(frame.fallbacks.map(value => value.cardId), [f.card.id]);
  assert.equal(f.workspace.layout.state.groupLayers[f.b.id], 'floating', 'the saved preference is not rewritten');
  assert.throws(() => project(['desktop']), error => error.code === 'desktop-layer', 'resting layers must be scenes the host has');
});

test('the adjust overlay arranges only while adjusting and its done button ends adjust mode', async () => {
  const f = await fixture();
  await rejects(f.command('layout.arrange', { kind: 'stack' }), 'desktop-arrange');
  await f.controller.activate({ kind: 'group', groupId: f.a.id });
  for (const kind of ['stack', 'spread', 'undo']) await f.command('layout.arrange', { kind });
  assert.deepEqual(f.arranged, ['stack', 'spread', 'undo']);
  await rejects(f.command('layout.arrange', { kind: 'shuffle' }), 'desktop-arrange');
  await f.command('interaction.done');
  assert.equal(f.controller.state.operationScope.kind, 'none');
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
  const f = await fixture();
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


test('attachment commands resolve current metadata, reject stale and foreign files, and keep wallpaper passive', async () => {
  const calls = []; const f = await fixture(async (method, file) => { calls.push({ method, file }); return { available: true, png: null }; });
  const file = { id: 'a'.repeat(64), name: 'proof.pdf', size: 3, mediaType: 'application/pdf', secret: 'not projected' };
  const card = await f.workspace.updateCard(f.card.id, { content: { ...f.card.content, attachments: [file] } }, f.card.revision);
  const args = { cardId: card.id, revision: card.revision, attachmentId: file.id, name: 'forged.exe' };
  await f.command('attachment.preview', args); await f.command('attachment.open', args);
  assert.equal(calls.length, 2); assert.equal(calls[1].file.name, 'proof.pdf');
  assert.deepEqual(f.frame().cards.find(value => value.id === card.id).attachments, [{ id: file.id, name: file.name }]);
  await rejects(f.command('attachment.open', { ...args, revision: f.card.revision }), 'desktop-expired');
  await rejects(f.command('attachment.open', { ...args, attachmentId: 'foreign' }), 'missing-attachment');
  await f.workspace.layout.setGroupLayer(f.a.id, 'wallpaper', f.workspace.snapshot);
  await f.command('attachment.preview', args);
  await rejects(f.command('attachment.open', args), 'outside-scope');
  await f.workspace.layout.configure({ desktopVisible: false }, f.workspace.snapshot);
  await rejects(f.command('attachment.preview', args), 'outside-scope');
  assert.equal(calls.length, 3);
});


test('a slow thumbnail never holds mutating desktop actions or the close barrier', async () => {
  const waiting = deferred(); const entered = deferred();
  const f = await fixture(async () => { entered.resolve(); return waiting.promise; });
  const file = { id: 'a'.repeat(64), name: 'proof.pdf' };
  const card = await f.workspace.updateCard(f.card.id, { content: { ...f.card.content, attachments: [file] } }, f.card.revision);
  const preview = f.command('attachment.preview', { cardId: card.id, revision: card.revision, attachmentId: file.id });
  await entered.promise;
  await f.command('interaction.shortcut', { key: 'Ctrl+Shift+1' });
  assert.equal(f.controller.state.operationScope.groupId, f.a.id);
  await f.authority.whenIdle();
  f.authority.close(); waiting.resolve({ available: true, png: null });
  await rejects(preview, 'desktop-view');
});
