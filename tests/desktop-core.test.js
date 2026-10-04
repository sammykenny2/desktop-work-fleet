import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups, copy, defaultGrid, FleetError, gridRegions, summaryText, validateGrid } from '../src/core/contracts.js';
import { Workspace } from '../src/core/workspace.js';
import { planFormation } from '../src/layout/formation.js';
import { createLayout, LayoutStore, reachable } from '../src/layout/store.js';
import { cardPolicy, InteractionController, resolveDropTarget, sceneOrder } from '../src/interaction/controller.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const workAreas = [area];
const markdown = text => ({ format: 'markdown', text, attachments: [] });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);

async function fixture() {
  let counter = 0; let durable; let fail = false;
  const persist = async state => {
    if (fail) throw new Error('disk full');
    durable = copy(state);
  };
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area,
    persist, uuid: () => `id-${String(++counter).padStart(4, '0')}` });
  const a = workspace.snapshot.groups[0];
  const b = await workspace.createGroup('別組');
  const a1 = await workspace.createCard(markdown('第一件事'), a.id);
  const a2 = await workspace.createCard(markdown('第二件事'), a.id);
  const b1 = await workspace.createCard(markdown('第三件事'), b.id);
  await workspace.layout.placeNew(workspace.snapshot, workAreas);
  const saved = [];
  const controller = new InteractionController({ getSnapshot: () => workspace.snapshot, layout: workspace.layout,
    commands: workspace, saveDraft: async id => { if (fail) throw new Error('disk full'); saved.push(id); } });
  return { workspace, controller, a, b, a1, a2, b1, saved, persist,
    disk: () => copy(durable), fail: value => { fail = value; } };
}

function plan(f, overrides = {}) {
  const snapshot = f.workspace.snapshot; const layout = f.workspace.layout.state;
  return planFormation({ snapshot, layout, scope: { kind: 'all' }, mode: 'stack', workAreas,
    summaryBands: Object.fromEntries(snapshot.cards.map(card => [card.id, 32])), ...overrides });
}

test('C01: quick capture needs only content and keeps extensible structured data', async () => {
  const f = await fixture();
  const content = { ...markdown('- [ ] 子步驟'), attachments: [{ id: 'blob-a', name: 'diagram.png' }], future: { value: 4 } };
  const card = await f.workspace.createCard(content);
  assert.equal(card.groupId, f.a.id);
  assert.deepEqual(card.content, content);
  assert.equal(summaryText(card), '子步驟');
  assert.equal('status' in card, false);
});

test('C02–C04: row-major grids, empty cells and all legal boundary values', () => {
  for (let rows = 1; rows <= 4; rows++) for (let columns = 1; columns <= 5; columns++) {
    if (rows <= 3 && columns <= 4 && rows * columns <= 9) validateGrid(rows, columns, 1);
    else throwsCode(() => validateGrid(rows, columns, 1), 'invalid-grid');
  }
  const groups = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}` }));
  const grid = { rows: 2, columns: 4, area, slots: [...groups.map(g => g.id), null] };
  const regions = gridRegions(grid, groups);
  assert.deepEqual(regions[4], { groupId: 'g4', x: 0, y: 450, width: 300, height: 450 });
  assert.equal(regions[7].groupId, null);
  throwsCode(() => validateGrid(2, 4, 9), 'invalid-grid');
  throwsCode(() => gridRegions({ ...grid, slots: [...groups.map(g => g.id), 'g0'] }, groups), 'invalid-slots');
});

test('C03: rejected grid preserves data and placements', async () => {
  const f = await fixture(); const before = f.disk();
  await rejectsCode(f.workspace.layout.configure({ grid: { ...before.layout.grid, rows: 3, columns: 4 } }, f.workspace.snapshot), 'invalid-grid');
  assert.deepEqual(f.disk(), before);
});

test('C05: renaming and remapping keep stable shortcut target IDs', async () => {
  const f = await fixture();
  await f.workspace.layout.configure({ shortcuts: { 'Ctrl+Shift+1': f.a.id } }, f.workspace.snapshot);
  await f.workspace.renameGroup(f.a.id, '新名稱', f.a.revision);
  const grid = f.workspace.layout.state.grid; grid.slots.reverse();
  await f.workspace.layout.configure({ grid }, f.workspace.snapshot);
  assert.equal(f.workspace.layout.state.shortcuts['Ctrl+Shift+1'], f.a.id);
});

test('C06–C08: group formation recalls by membership and leaves other cards in its region alone', async () => {
  const f = await fixture();
  await f.workspace.layout.move(f.a1.id, { x: 800, y: 400 });
  await f.workspace.layout.move(f.b1.id, { x: 50, y: 500 });
  const originalB = f.workspace.layout.state.placements[f.b1.id];
  const preview = plan(f, { scope: { kind: 'group', groupId: f.a.id } });
  assert.equal(f.workspace.layout.state.placements[f.a1.id].x, 800);
  await f.controller.applyFormation(preview);
  assert.ok(f.workspace.layout.state.placements[f.a1.id].x < 600);
  assert.deepEqual(f.workspace.layout.state.placements[f.b1.id], originalB);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
  assert.equal(f.controller.state.operationScope.kind, 'none');
});

test('C09/C12: stack exposes measured first lines; spread shows full fixed papers', async () => {
  const f = await fixture(); const sizes = f.workspace.layout.state.placements;
  const stacked = plan(f);
  assert.equal(stacked.changes[f.a2.id].y - stacked.changes[f.a1.id].y, 32);
  await f.controller.applyFormation(stacked);
  const spread = plan(f, { mode: 'spread' });
  for (const [id, rect] of Object.entries(spread.changes)) {
    assert.equal(rect.width, sizes[id].width); assert.equal(rect.height, sizes[id].height);
  }
  const x = spread.changes[f.a1.id]; const y = spread.changes[f.a2.id];
  assert.ok(x.x + x.width <= y.x || x.y + x.height <= y.y);
});

test('C10: overflow is explicit and impossible capacity leaves every paper untouched', async () => {
  const f = await fixture(); const layout = f.workspace.layout.state;
  layout.grid.area = { ...area, width: 500, height: 260 };
  const overflow = plan(f, { layout });
  assert.ok(overflow.overflow.length > 0);
  assert.deepEqual(overflow.resized, []);
  const before = f.disk();
  throwsCode(() => plan(f, { workAreas: [{ x: 0, y: 0, width: 80, height: 60 }] }), 'capacity');
  assert.deepEqual(f.disk(), before);
});

test('C10/C12: global overflow cannot stack two complete groups on the same pixels', () => {
  const groups = [{ id: 'a' }, { id: 'b' }];
  const small = { x: 0, y: 0, width: 700, height: 300 };
  const layout = createLayout('device', groups, small);
  const cards = groups.flatMap(group => Array.from({ length: 4 }, (_, i) => ({ id: `${group.id}${i}`, groupId: group.id })));
  cards.forEach((card, order) => { layout.placements[card.id] = { x: 0, y: 0, width: 280, height: 220, order }; });
  throwsCode(() => planFormation({ snapshot: { groups, cards }, layout, scope: { kind: 'all' }, mode: 'stack',
    workAreas: [small], summaryBands: Object.fromEntries(cards.map(card => [card.id, 32])) }), 'capacity');
});

test('global overflow uses connected free height beside an earlier shorter paper', () => {
  const groups = [{ id: 'a' }, { id: 'b' }]; const layout = createLayout('device', groups, area);
  const cards = groups.map(group => ({ id: group.id, groupId: group.id }));
  layout.placements.a = { x: 0, y: 0, width: 280, height: 220, order: 0 };
  layout.placements.b = { x: 0, y: 0, width: 800, height: 800, order: 1 };
  const preview = planFormation({ snapshot: { groups, cards }, layout, scope: { kind: 'all' }, mode: 'stack',
    workAreas, summaryBands: { a: 32, b: 32 } });
  assert.ok(preview.changes.b.x >= preview.changes.a.x + preview.changes.a.width);
  assert.ok(preview.changes.b.y + preview.changes.b.height <= 900);
});

test('C11: consent applies to one preview; undo restores geometry without rewinding text or policy', async () => {
  const f = await fixture(); const before = f.workspace.layout.state;
  const grid = { ...before.grid, area: { x: 0, y: 0, width: 440, height: 520 } };
  const preview = plan(f, { grid, allowResize: true });
  assert.ok(preview.resized.length > 0);
  await f.controller.applyFormation(preview);
  await f.workspace.updateCard(f.a1.id, { content: markdown('較新文字') }, f.a1.revision);
  await f.workspace.layout.setCardPolicy(f.a1.id, { residentLayer: 'floating', visible: false });
  await f.workspace.undo(workAreas);
  const restored = f.workspace.layout.state.placements[f.a1.id];
  assert.equal(restored.width, before.placements[f.a1.id].width);
  assert.equal(restored.residentLayer, 'floating'); assert.equal(restored.visible, false);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).content.text, '較新文字');
  assert.equal(plan(f).allowResize, false);
});

test('C13–C15/C17: cycling raises group and selection without geometry changes or narrowing All', async () => {
  const f = await fixture(); await f.workspace.layout.move(f.a1.id, { x: 950, y: 500 });
  await f.controller.activate({ kind: 'all' });
  const before = f.disk();
  f.controller.cycle(f.a.id); f.controller.cycle(f.a.id);
  const order = sceneOrder(f.workspace.snapshot.cards, f.workspace.layout.state, f.controller.state).map(c => c.id);
  assert.deepEqual(order, [f.b1.id, f.a1.id, f.a2.id]);
  assert.equal(f.controller.state.operationScope.kind, 'all');
  assert.deepEqual(f.disk(), before);
  f.controller.cycle(f.a.id);
  assert.equal(f.controller.state.selectedCardId, f.a1.id);
});

test('C16/C18: group policy enables only that group and editing never changes paper size', async () => {
  const f = await fixture(); const before = f.workspace.layout.state;
  await f.controller.activate({ kind: 'group', groupId: f.a.id });
  await f.controller.select(f.a1.id);
  assert.equal(f.controller.state.editingCardId, null);
  await f.controller.beginEdit(f.a1.id);
  assert.equal(cardPolicy(f.a1, before, f.controller.state).editing, true);
  assert.equal(cardPolicy(f.b1, before, f.controller.state).draggable, false);
  assert.deepEqual(f.workspace.layout.state, before);
});

test('C19/C20: jitter stays a click, text selection is not dragging, real drag suppresses double click', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  assert.equal((await f.controller.pointerUp({ x: 22, y: 21 })).kind, 'click');
  await f.controller.beginEdit(f.a1.id);
  assert.equal(f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }), false);
  assert.equal(f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { handle: true }), true);
  await f.controller.pointerUp({ x: 200, y: 100 });
  assert.equal(await f.controller.beginEdit(f.a1.id, { gesture: true }), false);
  assert.equal(await f.controller.beginEdit(f.a1.id), true);
  assert.equal(f.saved.includes(f.a1.id), true);
});

test('C21/C22/C26/C47: drop preview writes nothing, All transfer commits once with position and undo', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const initial = f.workspace.layout.state.placements[f.a1.id];
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  const labels = [{ groupId: f.b.id, x: 620, y: 0, width: 150, height: 40 }];
  f.controller.pointerMove({ x: 630, y: 20 }, { labels });
  assert.equal(f.controller.state.dragSession.target.groupId, f.b.id);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
  f.controller.pointerMove({ x: 630, y: 60 }, { labels });
  assert.equal(f.controller.state.dragSession.target, null);
  f.controller.pointerMove({ x: 630, y: 60 }, { shiftKey: true });
  const pending = f.controller.pointerUp({ x: 630, y: 60 }, { shiftKey: true });
  const duplicate = f.controller.pointerUp({ x: 630, y: 60 }, { shiftKey: true });
  assert.equal(pending, duplicate);
  assert.equal((await pending).kind, 'transferred');
  assert.equal(f.controller.state.operationScope.kind, 'all');
  assert.equal(f.controller.state.activeGroupId, f.b.id);
  assert.equal(f.workspace.layout.state.placements[f.a1.id].x, initial.x + 610);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.b.id);
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], initial);
});

test('C23/C24: blank cell and Shift cancellation never create or change groups', async () => {
  const f = await fixture(); const grid = { ...f.workspace.layout.state.grid, columns: 3, slots: [f.a.id, f.b.id, null] };
  await f.workspace.layout.configure({ grid }, f.workspace.snapshot);
  await f.controller.activate({ kind: 'all' });
  const before = f.workspace.layout.state;
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  assert.equal((await f.controller.pointerUp({ x: 1050, y: 50 }, { shiftKey: true })).kind, 'cancelled');
  assert.deepEqual(f.workspace.layout.state, before);
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  assert.equal((await f.controller.pointerUp({ x: 1050, y: 50 })).kind, 'moved');
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
  assert.equal(f.workspace.snapshot.groups.length, 2);
});

test('C24: capture loss and Escape discard only the current gesture', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  const before = f.disk();
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  f.controller.pointerMove({ x: 700, y: 100 }, { shiftKey: true });
  await f.controller.escape();
  assert.deepEqual(f.disk(), before); assert.equal(f.controller.state.operationScope.kind, 'all');
  assert.equal(f.controller.state.dragSession, null);
});

test('C25/C27: action transfer retains position; card exits A scope without activating B', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'group', groupId: f.a.id });
  const before = f.workspace.layout.state.placements[f.a1.id];
  await f.controller.moveToGroup(f.a1.id, f.b.id);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], before);
  assert.equal(f.controller.state.activeGroupId, f.a.id);
  const transferred = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  assert.equal(cardPolicy(transferred, f.workspace.layout.state, f.controller.state).draggable, false);
  assert.equal(cardPolicy(f.a2, f.workspace.layout.state, f.controller.state).draggable, true);
});

test('C28: target re-mapping during drag cancels instead of transferring to the new slot owner', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' });
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  f.controller.pointerMove({ x: 700, y: 100 }, { shiftKey: true });
  const grid = f.workspace.layout.state.grid; grid.slots.reverse();
  await f.workspace.layout.configure({ grid }, f.workspace.snapshot);
  assert.equal((await f.controller.pointerUp({ x: 700, y: 100 }, { shiftKey: true })).kind, 'cancelled');
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
});

test('C29/C30: stale transfer and transfer undo cannot overwrite newer text or membership', async () => {
  const f = await fixture();
  await f.workspace.updateCard(f.a1.id, { content: markdown('遠端新文字') }, f.a1.revision);
  await rejectsCode(f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision }), 'conflict');
  const current = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  assert.equal(current.content.text, '遠端新文字');
  assert.deepEqual(f.workspace.state.conflicts.at(-1), { kind: 'transfer', cardId: f.a1.id,
    groupId: f.b.id, expectedRevision: f.a1.revision });
  await f.workspace.transferCard({ cardId: current.id, groupId: f.b.id, expectedRevision: current.revision });
  const moved = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  await f.workspace.updateCard(moved.id, { content: markdown('轉組後又修改') }, moved.revision);
  const before = f.disk();
  await rejectsCode(f.workspace.undo(workAreas), 'conflict');
  assert.deepEqual(f.disk(), before);
});

test('C31/C32/C36: new placement only touches new cards; content and membership do not reflow', async () => {
  const f = await fixture(); const before = f.workspace.layout.state.placements;
  const fresh = await f.workspace.createCard(markdown('手機新增'), f.b.id);
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  for (const [id, rect] of Object.entries(before)) assert.deepEqual(f.workspace.layout.state.placements[id], rect);
  assert.ok(f.workspace.layout.state.placements[fresh.id].x >= 600);
  await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision });
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], before[f.a1.id]);
});

test('C33: failed draft flush prevents scope exit and formation with editor intact', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' }); await f.controller.beginEdit(f.a1.id);
  const before = f.disk(); const preview = plan(f); f.fail(true);
  await assert.rejects(f.controller.activate({ kind: 'group', groupId: f.b.id }), /disk full/);
  await assert.rejects(f.controller.applyFormation(preview), /disk full/);
  assert.equal(f.controller.state.editingCardId, f.a1.id); assert.deepEqual(f.disk(), before);
  f.fail(false); await f.controller.escape();
  assert.equal(f.controller.state.editingCardId, null); assert.equal(f.controller.state.operationScope.kind, 'all');
});

test('C34: IME and consumed keys cannot close editing or scope', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' }); await f.controller.beginEdit(f.a1.id);
  f.controller.setComposing(true);
  assert.equal(await f.controller.escape(), false);
  assert.equal(await f.controller.activate({ kind: 'all' }), false);
  assert.equal(f.controller.cycle(f.a.id), false);
  f.controller.setComposing(false);
  assert.equal(await f.controller.escape({ consumed: true }), false);
  assert.equal(f.controller.state.editingCardId, f.a1.id);
});

test('C35/C37: sessions are ephemeral and device geometry is independently persisted', async () => {
  const f = await fixture(); await f.controller.activate({ kind: 'all' }); await f.controller.beginEdit(f.a1.id);
  const second = new LayoutStore({ ...f.workspace.layout.state, deviceId: 'device-b' }, async () => {});
  const untouched = second.state;
  await f.controller.applyFormation(plan(f));
  assert.deepEqual(second.state, untouched);
  const reopened = new Workspace(f.disk(), f.persist);
  const controller = new InteractionController({ getSnapshot: () => reopened.snapshot, layout: reopened.layout,
    commands: reopened, saveDraft: async () => {} });
  assert.equal(controller.state.operationScope.kind, 'none'); assert.equal(controller.state.editingCardId, null);
});

test('C39: undo skips deleted cards and keeps newly added cards, respecting intervening moves', async () => {
  const f = await fixture(); await f.controller.applyFormation(plan(f));
  const afterFormation = f.workspace.layout.state.placements;
  await f.workspace.layout.move(f.a1.id, { x: 500, y: 600 });
  await f.workspace.undo(workAreas);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], afterFormation[f.a1.id]);
  await f.workspace.updateCard(f.a2.id, { deleted: true }, f.a2.revision);
  const newCard = await f.workspace.createCard(markdown('新卡'));
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  const newPosition = f.workspace.layout.state.placements[newCard.id];
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a2.id).deleted, true);
  assert.deepEqual(f.workspace.layout.state.placements[newCard.id], newPosition);
});

test('C43: display recovery moves only inaccessible titles and explains the reason', async () => {
  const f = await fixture(); await f.workspace.layout.move(f.a1.id, { x: 1800, y: 400 });
  const before = f.workspace.layout.state.placements;
  const result = await f.workspace.layout.recoverDisplays(workAreas);
  assert.deepEqual(result, { reason: 'display-unreachable', rescued: [f.a1.id] });
  assert.deepEqual(f.workspace.layout.state.placements[f.b1.id], before[f.b1.id]);
  assert.equal(reachable(f.workspace.layout.state.placements[f.a1.id], workAreas), true);
});

test('C44: creation stops at nine; reading ten preserves data and rejects formation', async () => {
  const f = await fixture(); for (let i = 2; i < 9; i++) await f.workspace.createGroup(`組 ${i}`);
  await rejectsCode(f.workspace.createGroup('第十組'), 'group-limit');
  const remote = f.workspace.snapshot;
  remote.groups.push({ id: 'remote-tenth', name: '离線新增', revision: 'r1' });
  const before = copy(remote);
  throwsCode(() => defaultGrid(activeGroups(remote), area), 'group-overflow');
  assert.deepEqual(remote, before);
});

test('C45/C46: hidden cards stay hidden and exit uses current resident policy', async () => {
  const f = await fixture(); await f.workspace.layout.setCardPolicy(f.a1.id, { visible: false });
  await f.workspace.layout.configure({ desktopVisible: false }, f.workspace.snapshot);
  await f.controller.activate({ kind: 'all' });
  assert.equal(cardPolicy(f.a1, f.workspace.layout.state, f.controller.state).visible, false);
  assert.equal(cardPolicy(f.a2, f.workspace.layout.state, f.controller.state).visible, true);
  await f.workspace.layout.setCardPolicy(f.a2.id, { residentLayer: 'floating' });
  await f.controller.escape();
  const policy = cardPolicy(f.a2, f.workspace.layout.state, f.controller.state);
  assert.equal(policy.visible, false); assert.equal(policy.layer, 'floating'); assert.equal(policy.editing, false);
});

test('formation refuses previews after a new card or a moved card', async () => {
  const f = await fixture(); const first = plan(f);
  await f.workspace.createCard(markdown('預覽後新增'));
  await rejectsCode(f.controller.applyFormation(first), 'stale-plan');
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  const second = plan(f); await f.workspace.layout.move(f.a1.id, { x: 800, y: 200 });
  await rejectsCode(f.controller.applyFormation(second), 'stale-plan');
});

test('atomic persistence failure leaves membership, geometry, undo and outbox unchanged', async () => {
  const f = await fixture(); const before = f.disk(); f.fail(true);
  await assert.rejects(f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision,
    position: { x: 800, y: 400 } }), /disk full/);
  assert.deepEqual(f.workspace.state, before); assert.deepEqual(f.workspace.layout.state, before.layout);
  f.fail(false);
  await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision });
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.b.id);
});

test('serialized operations and independent draft IDs survive reopening', async () => {
  const f = await fixture();
  await Promise.all([
    f.workspace.saveDraft({ id: 'editor-one', cardId: f.a1.id, content: markdown('甲') }),
    f.workspace.saveDraft({ id: 'editor-two', cardId: f.a1.id, content: markdown('乙') }),
    f.workspace.layout.move(f.b1.id, { x: 900, y: 600 }),
  ]);
  const reopened = new Workspace(f.disk(), f.persist);
  assert.deepEqual(Object.values(reopened.state.drafts).map(draft => draft.content.text), ['甲', '乙']);
  assert.equal(reopened.layout.state.placements[f.b1.id].x, 900);
});

test('C27: mobile transfer works for a card with no desktop placement', async () => {
  const f = await fixture(); const card = await f.workspace.createCard(markdown('只有手機'));
  await f.workspace.transferCard({ cardId: card.id, groupId: f.b.id, expectedRevision: card.revision });
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === card.id).groupId, f.b.id);
  assert.equal(f.workspace.layout.state.placements[card.id], undefined);
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === card.id).groupId, f.a.id);
});

test('two local transfers undo in order without confusing inverse revisions with remote edits', async () => {
  const f = await fixture();
  await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision });
  const moved = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.a.id, expectedRevision: moved.revision });
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.b.id);
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
});

test('C48: source and persistence adapters remain replaceable with the same interaction semantics', async () => {
  const f = await fixture();
  let snapshot = f.workspace.snapshot;
  const layout = new LayoutStore(f.workspace.layout.state, async () => {});
  const controller = new InteractionController({ getSnapshot: () => copy(snapshot), layout,
    saveDraft: async () => {}, commands: { transferCard: async command => {
      const card = snapshot.cards.find(c => c.id === command.cardId);
      assert.equal(command.expectedRevision, card.revision);
      card.groupId = command.groupId; card.revision = 'fake-next';
    } } });
  await controller.activate({ kind: 'all' });
  await controller.moveToGroup(f.a1.id, f.b.id);
  assert.equal(controller.state.operationScope.kind, 'all');
  assert.equal(controller.state.activeGroupId, f.b.id);
  assert.deepEqual(layout.state.placements, f.workspace.layout.state.placements);
});

test('queued archive invalidates formation at the shared atomic commit boundary', async () => {
  const f = await fixture();
  let signal; let release;
  const started = new Promise(resolve => { signal = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const workspace = new Workspace(f.disk(), async next => {
    if (next.cards.some(card => card.archived)) { signal(); await gate; }
  });
  const preview = plan({ workspace });
  const update = workspace.updateCard(f.a1.id, { archived: true }, f.a1.revision);
  await started;
  const formation = workspace.layout.applyFormation(preview, () => workspace.snapshot);
  await new Promise(resolve => setImmediate(resolve));
  release(); await update;
  await rejectsCode(formation, 'stale-plan');
  assert.deepEqual(workspace.layout.state, f.workspace.layout.state);
});

test('read-only source blocks both transfer entry points while allowing device-only moves', async () => {
  const f = await fixture(); let calls = 0;
  const controller = new InteractionController({ getSnapshot: () => ({ ...f.workspace.snapshot, writable: false }),
    layout: f.workspace.layout, saveDraft: async () => {}, commands: { transferCard: async () => { calls++; } } });
  await controller.activate({ kind: 'all' });
  await rejectsCode(controller.moveToGroup(f.a1.id, f.b.id), 'read-only');
  controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  await rejectsCode(controller.pointerUp({ x: 700, y: 60 }, { shiftKey: true }), 'read-only');
  controller.pointerDown(f.a1.id, { x: 20, y: 20 });
  assert.equal((await controller.pointerUp({ x: 700, y: 60 })).kind, 'moved');
  assert.equal(calls, 0);
});

test('selection follows externally changed group in All and stays within a single-group scope', async () => {
  for (const all of [true, false]) {
    const f = await fixture();
    await f.controller.activate(all ? { kind: 'all' } : { kind: 'group', groupId: f.a.id });
    await f.controller.select(f.a1.id);
    await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision });
    await f.controller.reconcile();
    assert.equal(f.controller.state.activeGroupId, all ? f.b.id : f.a.id);
    assert.equal(f.controller.state.selectedCardId, all ? f.a1.id : f.a2.id);
  }
});

test('caller mutation after command submission cannot change validated or durable payloads', async () => {
  const f = await fixture();
  const patch = { content: markdown('submitted') };
  const pending = f.workspace.updateCard(f.a1.id, patch, f.a1.revision);
  patch.archived = 'not boolean'; patch.content.text = 'mutated';
  const saved = await pending;
  assert.equal(saved.archived, false); assert.equal(saved.content.text, 'submitted');
  const draft = { id: 'draft', cardId: f.a1.id, content: markdown('draft submission') };
  const draftPending = f.workspace.saveDraft(draft); draft.content.text = 'mutated'; await draftPending;
  assert.equal(f.workspace.state.drafts.draft.content.text, 'draft submission');
  const policy = { visible: false }; const policyPending = f.workspace.layout.setCardPolicy(f.a1.id, policy);
  policy.visible = 'bad'; await policyPending;
  assert.equal(f.workspace.layout.state.placements[f.a1.id].visible, false);
});

test('unsafe dictionary keys and invalid content are rejected before persistence', async () => {
  const f = await fixture(); const before = f.disk();
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    await rejectsCode(f.workspace.saveDraft({ id, cardId: f.a1.id, content: markdown('never silently lose this') }), 'invalid-draft');
  }
  await rejectsCode(f.workspace.updateCard(f.a1.id, { content: null }, f.a1.revision), 'invalid-content');
  assert.deepEqual(f.disk(), before);
});

test('formation input is frozen before waiting for a draft flush', async () => {
  const f = await fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new InteractionController({ getSnapshot: () => f.workspace.snapshot, layout: f.workspace.layout,
    commands: f.workspace, saveDraft: () => gate });
  await controller.activate({ kind: 'all' }); await controller.beginEdit(f.a1.id);
  const preview = plan(f); const x = preview.changes[f.a1.id].x;
  const pending = controller.applyFormation(preview);
  preview.changes[f.a1.id].x = 800; preview.scope = { kind: 'group', groupId: f.b.id };
  release(); await pending;
  assert.equal(f.workspace.layout.state.placements[f.a1.id].x, x);
  assert.equal(controller.state.activeGroupId, null);
});

test('durable draft commit is atomic with its outbox record and restores deleted content', async () => {
  const f = await fixture(); const draft = f.workspace.blankDraft(f.a.id);
  draft.content = { ...markdown('saved from draft'), attachments: [{ id: 'digest', name: 'proof.txt', size: 8 }] };
  await f.workspace.saveDraft(draft); const before = f.disk(); f.fail(true);
  await assert.rejects(f.workspace.commitDraft(draft.id), /disk full/);
  assert.deepEqual(f.disk(), before);
  f.fail(false); const card = await f.workspace.commitDraft(draft.id);
  assert.equal(f.workspace.state.drafts[draft.id], undefined);
  assert.deepEqual(f.workspace.state.outbox.at(-1).value.content, draft.content);
  const deleted = await f.workspace.updateCard(card.id, { deleted: true }, card.revision);
  const restored = await f.workspace.restoreCard(deleted.id, deleted.revision);
  assert.equal(restored.deleted, false); assert.deepEqual(restored.content, draft.content);
});

test('conflicted drafts stay durable and can become independent copies', async () => {
  const f = await fixture(); const draft = f.workspace.blankDraft(f.a.id, f.a1); draft.content.text = 'my edit';
  await f.workspace.saveDraft(draft);
  await f.workspace.updateCard(f.a1.id, { content: markdown('newer edit') }, f.a1.revision);
  await rejectsCode(f.workspace.commitDraft(draft.id), 'conflict');
  assert.equal(f.workspace.state.drafts[draft.id].content.text, 'my edit');
  const copied = await f.workspace.commitDraft(draft.id, { asCopy: true });
  assert.notEqual(copied.id, f.a1.id); assert.equal(copied.content.text, 'my edit');
  assert.equal(currentText(f.workspace, f.a1.id), 'newer edit');
});

function currentText(workspace, cardId) { return workspace.snapshot.cards.find(card => card.id === cardId).content.text; }

test('saving a recovered draft clears its unchanged original but retains an independently updated original', async () => {
  for (const changed of [false, true]) {
    const f = await fixture(); const original = f.workspace.blankDraft(f.a.id); original.content.text = 'original';
    await f.workspace.saveDraft(original);
    const recovered = f.workspace.recoverDraft(original.id); recovered.content.text = 'recovered edit';
    await f.workspace.saveDraft(recovered);
    if (changed) await f.workspace.saveDraft({ ...original, content: markdown('independent edit') });
    await f.workspace.commitDraft(recovered.id);
    assert.equal(Object.keys(f.workspace.state.drafts).length, changed ? 1 : 0);
    if (changed) assert.equal(f.workspace.state.drafts[original.id].content.text, 'independent edit');
  }
});

test('repeated draft recovery consumes unchanged ancestors with linear lineage and preserves changed ones', async () => {
  for (const changed of [false, true]) {
    const f = await fixture(); let draft = f.workspace.blankDraft(f.a.id); draft.content.text = 'first';
    await f.workspace.saveDraft(draft); const ancestors = [copy(draft)];
    for (let i = 0; i < 12; i++) {
      draft = f.workspace.recoverDraft(draft.id); draft.content.text = `session ${i}`;
      await f.workspace.saveDraft(draft);
      if (i < 11) ancestors.push(copy(draft));
    }
    assert.equal(draft.recoveredFrom.length, 12);
    assert.ok(JSON.stringify(draft.recoveredFrom).length < 12 * 1000, 'lineage must not recursively embed prior lineage');
    if (changed) {
      for (const origin of [ancestors[0], ancestors[6]]) await f.workspace.saveDraft({ ...origin, content: markdown('independent') });
    }
    const before = f.disk(); f.fail(true);
    await assert.rejects(f.workspace.commitDraft(draft.id), /disk full/); assert.deepEqual(f.disk(), before);
    f.fail(false); const saved = await f.workspace.commitDraft(draft.id);
    assert.equal(saved.content.text, 'session 11');
    assert.equal(Object.keys(f.workspace.state.drafts).length, changed ? 2 : 0);
    assert.ok(Object.values(f.workspace.state.drafts).every(item => item.content.text === 'independent'));
  }
});
