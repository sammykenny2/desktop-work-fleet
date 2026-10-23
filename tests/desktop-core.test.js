import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroups, containsRect, copy, defaultGrid, FleetError, gridRegions, summaryText, validateGrid } from '../src/core/contracts.js';
import { Workspace } from '../src/core/workspace.js';
import { planFormation } from '../src/layout/formation.js';
import { createLayout, LayoutStore, mainGroup, mainView, reachable } from '../src/layout/store.js';
import { cardPolicy, InteractionController, resolveDropTarget, sceneOrder } from '../src/interaction/controller.js';
import { stepGroup } from '../src/layout/stages.js';

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
  const b = await workspace.createGroup('Other group');
  const a1 = await workspace.createCard(markdown('First task'), a.id);
  const a2 = await workspace.createCard(markdown('Second task'), a.id);
  const b1 = await workspace.createCard(markdown('Third task'), b.id);
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
  const content = { ...markdown('- [ ] Substep'), attachments: [{ id: 'blob-a', name: 'diagram.png' }], future: { value: 4 } };
  const card = await f.workspace.createCard(content);
  assert.equal(card.groupId, f.a.id);
  assert.deepEqual(card.content, content);
  assert.equal(summaryText(card), 'Substep');
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
  await f.workspace.renameGroup(f.a.id, 'New name', f.a.revision);
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

test('stack and spread arrange new square papers beside older 280 × 220 ones, keeping each size', () => {
  // Papers placed before papers became square keep 280 × 220, so a group can hold both sizes.
  const band = 36;
  const covers = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  // The last scene's 3 × 3 regions are shorter than a 240 × 240 paper placed on a taller screen; those papers overflow
  // but stay on screen and apart.
  const scenes = [[1920, 1032, 1, 3], [1920, 1032, 4, 3], [1920, 1032, 9, 2], [1280, 775, 9, 1]];
  for (const [width, height, groupCount, perGroup] of scenes) for (const mode of ['stack', 'spread']) {
    const workArea = { x: 0, y: 0, width, height }; const name = `${mode} ${groupCount} groups on ${width} × ${height}`;
    const groups = Array.from({ length: groupCount }, (_, i) => ({ id: `g${i}` }));
    const layout = createLayout('device', groups, workArea);
    const cards = groups.flatMap(group => Array.from({ length: perGroup }, (_, i) => ({ id: `${group.id}-${i}`, groupId: group.id })));
    cards.forEach((card, order) => {
      layout.placements[card.id] = { x: 0, y: 0, order, ...(order % 2 ? { width: 240, height: 240 } : { width: 280, height: 220 }) };
    });
    const preview = planFormation({ snapshot: { groups, cards }, layout, scope: { kind: 'all' }, mode, workAreas: [workArea],
      summaryBands: Object.fromEntries(cards.map(card => [card.id, band])) });
    const placed = cards.map(card => ({ ...preview.changes[card.id], groupId: card.groupId }));
    cards.forEach((card, index) => {
      assert.deepEqual([placed[index].width, placed[index].height], [layout.placements[card.id].width, layout.placements[card.id].height], name);
      assert.ok(containsRect(workArea, placed[index]), name);
    });
    for (const a of placed) for (const b of placed) {
      if (a === b) continue;
      if (mode === 'spread' || a.groupId !== b.groupId) assert.ok(!covers(a, b), `${name}: papers must not overlap`);
      // A stacked paper keeps its title band visible under every paper laid over it.
      else if (b.order > a.order) assert.ok(!covers({ ...a, height: band }, b), `${name}: a title band is covered`);
    }
  }
});

test('a new paper stays square but shrinks to fit a short region, never below 160', async () => {
  const groups = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}` }));
  const cards = groups.map(group => ({ id: `${group.id}-0`, groupId: group.id }));
  // [work area width, height, expected side, whether stack and spread then keep every paper in its region]
  for (const [width, height, side, fits] of [[1920, 1032, 240, true], [1280, 775, 234, true], [1366, 728, 218, true], [900, 540, 160, false]]) {
    const workArea = { x: 0, y: 0, width, height }; const name = `9 groups on ${width} × ${height}`;
    const store = new LayoutStore(createLayout('device', groups, workArea), async () => {});
    await store.placeNew({ groups, cards }, [workArea]);
    const layout = store.state; const regions = gridRegions(layout.grid, groups);
    for (const card of cards) {
      const rect = layout.placements[card.id];
      assert.deepEqual([rect.width, rect.height], [side, side], name);
      assert.ok(containsRect(regions.find(region => region.groupId === card.groupId), rect), name);
    }
    if (fits) for (const mode of ['stack', 'spread']) {
      const preview = planFormation({ snapshot: { groups, cards }, layout, scope: { kind: 'all' }, mode, workAreas: [workArea],
        summaryBands: Object.fromEntries(cards.map(card => [card.id, 36])) });
      assert.deepEqual(preview.overflow, [], `${mode}, ${name}`);
    }
  }
});

test('a new paper takes the first free place in its region and, once it is full, never lands on another paper', async () => {
  const groups = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}` }));
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const store = new LayoutStore(createLayout('device', groups, workArea), async () => {});
  const region = gridRegions(store.state.grid, groups)[0]; const cards = [];
  const add = async (patch = {}) => {
    const card = { id: `c${String(cards.length).padStart(2, '0')}`, groupId: 'g0', ...patch }; cards.push(card);
    await store.placeNew({ groups, cards: [...cards] }, [workArea]);
    return store.state.placements[card.id];
  };
  // Papers arriving one at a time, as from sync, fill the 480-wide region down its one column instead of a diagonal.
  const column = [];
  for (let i = 0; i < 4; i++) column.push(await add());
  assert.deepEqual(column.map(rect => [rect.x, rect.y]), [[12, 12], [12, 264], [12, 516], [12, 768]]);
  for (const rect of column) assert.ok(containsRect(region, rect));
  // A full region cascades, keeping every earlier paper's corner and title band in sight.
  for (let i = 0; i < 3; i++) {
    const rect = await add(); const others = cards.slice(0, -1).map(card => store.state.placements[card.id]);
    assert.ok(containsRect(region, rect));
    for (const other of others) assert.ok(Math.abs(rect.x - other.x) >= 18 || Math.abs(rect.y - other.y) >= 28, 'a corner is covered');
  }

  // Deleted, hidden and completed papers keep their placement but leave their place free.
  const fresh = new LayoutStore(createLayout('device', groups, workArea), async () => {});
  const papers = [{ id: 'a', groupId: 'g0' }, { id: 'b', groupId: 'g0' }, { id: 'c', groupId: 'g0' }];
  await fresh.placeNew({ groups, cards: papers }, [workArea]);
  await fresh.setCardPolicy('b', { visible: false });
  const later = [{ ...papers[0], deleted: true }, papers[1], { ...papers[2], completed: true },
    { id: 'd', groupId: 'g0' }, { id: 'e', groupId: 'g0' }, { id: 'f', groupId: 'g0' }];
  await fresh.placeNew({ groups, cards: later }, [workArea]);
  assert.deepEqual(['d', 'e', 'f'].map(id => [fresh.state.placements[id].x, fresh.state.placements[id].y]),
    [[12, 12], [12, 264], [12, 516]]);

  // A paper the user moved leaves the room around it free.
  const moved = new LayoutStore(createLayout('device', groups, workArea), async () => {});
  await moved.placeNew({ groups, cards: [{ id: 'a', groupId: 'g0' }] }, [workArea]);
  await moved.move('a', { x: 40, y: 30 });
  await moved.placeNew({ groups, cards: [{ id: 'a', groupId: 'g0' }, { id: 'b', groupId: 'g0' }] }, [workArea]);
  assert.deepEqual([moved.state.placements.b.x, moved.state.placements.b.y], [12, 282]);
});

test('a new paper fills a wider region row by row, as a spread does', async () => {
  const groups = Array.from({ length: 3 }, (_, i) => ({ id: `g${i}` }));
  const workArea = { x: 0, y: 0, width: 1920, height: 1032 };
  const store = new LayoutStore(createLayout('device', groups, workArea), async () => {});
  const cards = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, groupId: 'g1' }));
  await store.placeNew({ groups, cards }, [workArea]);
  assert.deepEqual(cards.map(card => [store.state.placements[card.id].x, store.state.placements[card.id].y]),
    [[652, 12], [904, 12], [652, 264], [904, 264]]);
});

test('C11: consent applies to one preview; undo restores geometry without rewinding text or policy', async () => {
  const f = await fixture(); const before = f.workspace.layout.state;
  const grid = { ...before.grid, area: { x: 0, y: 0, width: 440, height: 520 } };
  const preview = plan(f, { grid, allowResize: true });
  assert.ok(preview.resized.length > 0);
  await f.controller.applyFormation(preview);
  await f.workspace.updateCard(f.a1.id, { content: markdown('Newer text') }, f.a1.revision);
  await f.workspace.layout.setCardPolicy(f.a1.id, { visible: false });
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  await f.workspace.undo(workAreas);
  const restored = f.workspace.layout.state.placements[f.a1.id];
  assert.equal(restored.width, before.placements[f.a1.id].width);
  assert.equal(f.workspace.layout.state.groupLayers[f.a.id], 'floating'); assert.equal(restored.visible, false);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).content.text, 'Newer text');
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

test('C49–C54/C56: quick move is off by default and, once on, moves one resting paper as an ordinary move', async () => {
  const f = await fixture(); const start = copy(f.workspace.layout.state.placements[f.a1.id]);
  assert.equal(f.workspace.layout.state.quickMove, undefined);
  throwsCode(() => f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }), 'quick-move-off');
  await rejectsCode(f.workspace.layout.configure({ quickMove: 'yes' }, f.workspace.snapshot), 'invalid-setting');
  await f.workspace.layout.configure({ quickMove: true }, f.workspace.snapshot);
  assert.equal(f.disk().layout.quickMove, true);
  // Only the quick path takes a resting paper; an ordinary drag still needs adjust mode.
  throwsCode(() => f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }), 'outside-scope');
  assert.equal(f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }), true);
  assert.equal((await f.controller.pointerUp({ x: 22, y: 21 })).kind, 'click');
  assert.equal(f.controller.state.selectedCardId, null); assert.equal(f.workspace.layout.state.history.length, 0);
  // Labels, regions and Shift never turn it into a transfer, and nothing enters adjust mode.
  const labels = [{ groupId: f.b.id, x: 620, y: 0, width: 150, height: 40 }];
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true });
  f.controller.pointerMove({ x: 630, y: 20 }, { labels, shiftKey: true });
  assert.equal(f.controller.state.dragSession.target, null); assert.equal(f.controller.state.operationScope.kind, 'none');
  assert.equal((await f.controller.pointerUp({ x: 630, y: 20 }, { labels, shiftKey: true })).kind, 'moved');
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a1.id).groupId, f.a.id);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], { ...start, x: start.x + 610 });
  assert.equal(f.disk().layout.placements[f.a1.id].x, start.x + 610);
  assert.deepEqual(f.workspace.layout.state.history.map(entry => entry.kind), ['move']);
  await f.workspace.undo(workAreas);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], start);
});

test('C55: a quick move saves nothing once the setting, the layer, the desktop or the scope changes under it', async () => {
  const f = await fixture(); await f.workspace.layout.configure({ quickMove: true }, f.workspace.snapshot);
  const start = copy(f.workspace.layout.state.placements[f.a1.id]);
  const attempt = async (change, restore) => {
    f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }); f.controller.pointerMove({ x: 300, y: 200 });
    await change(); const result = await f.controller.pointerUp({ x: 300, y: 200 }); await restore();
    assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], start); assert.equal(f.workspace.layout.state.history.length, 0);
    assert.equal(f.controller.state.dragSession, null);
    return result;
  };
  const configure = patch => () => f.workspace.layout.configure(patch, f.workspace.snapshot);
  assert.equal((await attempt(configure({ quickMove: false }), configure({ quickMove: true }))).reason, 'quick-move-ended');
  assert.equal((await attempt(() => f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot),
    () => f.workspace.layout.setGroupLayer(f.a.id, 'desktop', f.workspace.snapshot))).reason, 'quick-move-ended');
  assert.equal((await attempt(configure({ desktopVisible: false }), configure({ desktopVisible: true }))).reason, 'quick-move-ended');
  assert.equal((await attempt(() => f.controller.activate({ kind: 'all' }), () => f.controller.activate({ kind: 'none' }))).kind, 'ignored');
  assert.equal((await attempt(() => f.controller.escape(), async () => {})).kind, 'ignored');
  // A wallpaper paper lets clicks through, so it never starts one.
  await f.workspace.layout.setGroupLayer(f.a.id, 'wallpaper', f.workspace.snapshot);
  throwsCode(() => f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }), 'quick-move-off');
});

test('a quick move keeps the title within reach, and a layout reset turns quick move off', async () => {
  const f = await fixture(); await f.workspace.layout.configure({ quickMove: true }, f.workspace.snapshot);
  const controller = new InteractionController({ getSnapshot: () => f.workspace.snapshot, layout: f.workspace.layout,
    commands: f.workspace, saveDraft: async () => {}, workAreas: () => workAreas });
  const start = copy(f.workspace.layout.state.placements[f.a1.id]);
  controller.pointerDown(f.a1.id, { x: start.x + 10, y: start.y + 10 }, { quick: true });
  assert.equal((await controller.pointerUp({ x: start.x + 10, y: start.y - 5000 })).kind, 'moved');
  const moved = f.workspace.layout.state.placements[f.a1.id];
  assert.ok(reachable(moved, workAreas)); assert.deepEqual([moved.x, moved.y], [start.x, area.y]);
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.equal(f.workspace.layout.state.quickMove, undefined);
});

test('a quick move comes to the front only once it drags, survives unrelated layout saves and leaves editing alone', async () => {
  const f = await fixture(); await f.workspace.layout.configure({ quickMove: true }, f.workspace.snapshot);
  const front = () => sceneOrder(f.workspace.snapshot.cards, f.workspace.layout.state, f.controller.state).at(-1).id;
  const resting = front(); assert.notEqual(resting, f.a1.id);
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true });
  assert.equal(front(), resting, 'a press below the threshold changes nothing');
  f.controller.pointerMove({ x: 120, y: 20 });
  assert.equal(front(), f.a1.id);
  // A save that does not touch this paper, such as a synced paper being placed, does not end the move.
  await f.workspace.layout.configure({ mainView: 'list' }, f.workspace.snapshot);
  assert.equal((await f.controller.pointerUp({ x: 120, y: 20 })).kind, 'moved');
  // Nothing is suppressed afterwards: in adjust mode the moved paper still opens for editing.
  await f.controller.activate({ kind: 'all' });
  assert.equal(await f.controller.beginEdit(f.a1.id, { gesture: true }), true);
  await f.controller.endEdit(); await f.controller.activate({ kind: 'none' });
  // Anything else moving this paper while it is held ends the move, and so does reconcile once it is no longer allowed.
  const start = copy(f.workspace.layout.state.placements[f.a1.id]);
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }); f.controller.pointerMove({ x: 300, y: 20 });
  await f.workspace.layout.move(f.a1.id, { x: start.x + 1, y: start.y });
  assert.equal((await f.controller.pointerUp({ x: 300, y: 20 })).reason, 'quick-move-ended');
  assert.equal(f.workspace.layout.state.placements[f.a1.id].x, start.x + 1);
  f.controller.pointerDown(f.a1.id, { x: 20, y: 20 }, { quick: true }); f.controller.pointerMove({ x: 300, y: 20 });
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot); await f.controller.reconcile();
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
  await f.workspace.updateCard(f.a1.id, { content: markdown('New remote text') }, f.a1.revision);
  await rejectsCode(f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision }), 'conflict');
  const current = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  assert.equal(current.content.text, 'New remote text');
  assert.deepEqual(f.workspace.state.conflicts.at(-1), { kind: 'transfer', cardId: f.a1.id,
    groupId: f.b.id, expectedRevision: f.a1.revision });
  await f.workspace.transferCard({ cardId: current.id, groupId: f.b.id, expectedRevision: current.revision });
  const moved = f.workspace.snapshot.cards.find(c => c.id === f.a1.id);
  await f.workspace.updateCard(moved.id, { content: markdown('Edited after the move') }, moved.revision);
  const before = f.disk();
  await rejectsCode(f.workspace.undo(workAreas), 'conflict');
  assert.deepEqual(f.disk(), before);
});

test('C31/C32/C36: new placement only touches new cards; content and membership do not reflow', async () => {
  const f = await fixture(); const before = f.workspace.layout.state.placements;
  const fresh = await f.workspace.createCard(markdown('Added on the phone'), f.b.id);
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  for (const [id, rect] of Object.entries(before)) assert.deepEqual(f.workspace.layout.state.placements[id], rect);
  assert.ok(f.workspace.layout.state.placements[fresh.id].x >= 600);
  await f.workspace.transferCard({ cardId: f.a1.id, groupId: f.b.id, expectedRevision: f.a1.revision });
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  assert.deepEqual(f.workspace.layout.state.placements[f.a1.id], before[f.a1.id]);
});

test('new papers are square and the main-window view is a per-device setting kept through a layout reset', async () => {
  const f = await fixture();
  for (const card of [f.a1, f.a2, f.b1]) {
    const { width, height } = f.workspace.layout.state.placements[card.id];
    assert.deepEqual({ width, height }, { width: 240, height: 240 });
  }
  assert.equal(f.workspace.layout.state.mainView, undefined); assert.equal(mainView(f.workspace.layout.state), 'board');
  await rejectsCode(f.workspace.layout.configure({ mainView: 'grid' }, f.workspace.snapshot), 'invalid-setting');
  await f.workspace.layout.configure({ mainView: 'list' }, f.workspace.snapshot);
  assert.equal(mainView(f.workspace.layout.state), 'list'); assert.equal(f.disk().layout.mainView, 'list');
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.equal(mainView(f.workspace.layout.state), 'list', 'resetting the desktop layout keeps the main-window view');
});

test('the main window remembers its group per device through a layout reset and falls back to the first group', async () => {
  const f = await fixture(); const groups = activeGroups(f.workspace.snapshot);
  assert.equal(f.workspace.layout.state.mainGroupId, undefined); assert.equal(mainGroup(f.workspace.layout.state, groups), groups[0].id);
  await rejectsCode(f.workspace.layout.setMainGroup('missing-group', f.workspace.snapshot), 'missing-group');
  await rejectsCode(f.workspace.layout.setMainGroup(null, f.workspace.snapshot), 'missing-group');
  // A group added by a sync after the choice was made does not refuse it.
  const chosenFrom = f.workspace.snapshot; await f.workspace.createGroup('Arrived meanwhile');
  await f.workspace.layout.setMainGroup(f.b.id, chosenFrom);
  assert.equal(mainGroup(f.workspace.layout.state, groups), f.b.id); assert.equal(f.disk().layout.mainGroupId, f.b.id);
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.equal(f.workspace.layout.state.mainGroupId, f.b.id, 'resetting the desktop layout keeps the main-window group');
  assert.equal(mainGroup(f.workspace.layout.state, groups.filter(group => group.id !== f.b.id)), groups.find(group => group.id !== f.b.id).id,
    'a remembered group that is gone falls back to the first group shown');
});

test('layout reset re-places every paper by group and keeps content, groups and shortcuts', async () => {
  const f = await fixture();
  await f.workspace.layout.move(f.a1.id, { x: 900, y: 700 });
  await f.workspace.layout.setCardPolicy(f.a2.id, { visible: false });
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  await f.workspace.layout.configure({ desktopVisible: false, myGroupId: f.b.id,
    grid: { ...f.workspace.layout.state.grid, rows: 2, columns: 1 } }, f.workspace.snapshot);
  const shortcuts = f.workspace.layout.state.shortcuts; const cards = copy(f.workspace.snapshot.cards);
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.deepEqual(f.workspace.layout.state.placements, {});
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  const layout = f.workspace.layout.state;
  assert.deepEqual(layout.grid, defaultGrid(activeGroups(f.workspace.snapshot), area));
  assert.equal(layout.desktopVisible, true); assert.equal(layout.myGroupId, null); assert.deepEqual(layout.history, []);
  assert.deepEqual(layout.shortcuts, shortcuts); assert.deepEqual(f.workspace.snapshot.cards, cards);
  for (const card of [f.a1, f.a2]) assert.ok(layout.placements[card.id].x < 600, 'first group papers return to its region');
  assert.ok(layout.placements[f.b1.id].x >= 600);
  assert.deepEqual(Object.values(layout.placements).map(rect => rect.visible), [true, true, true]);
  assert.deepEqual(layout.groupLayers, {}, 'without a back layer every group is back on the desktop layer');
});

test('layout reset puts every active group on the back layer it is given', async () => {
  const f = await fixture(); const c = await f.workspace.createGroup('Retired group');
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(c.id, f.b.id));
  await rejectsCode(f.workspace.layout.reset(f.workspace.snapshot, area, 'ceiling'), 'invalid-setting');
  await f.workspace.layout.reset(f.workspace.snapshot, area, 'wallpaper');
  assert.deepEqual(f.workspace.layout.state.groupLayers, { [f.a.id]: 'wallpaper', [f.b.id]: 'wallpaper' }, 'a retired group gets no layer');
  assert.deepEqual(f.disk().layout.groupLayers, f.workspace.layout.state.groupLayers);
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
  const newCard = await f.workspace.createCard(markdown('New note'));
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas);
  const newPosition = f.workspace.layout.state.placements[newCard.id];
  await f.workspace.undo(workAreas);
  assert.equal(f.workspace.snapshot.cards.find(c => c.id === f.a2.id).deleted, true);
  assert.deepEqual(f.workspace.layout.state.placements[newCard.id], newPosition);
});

test('C43: display recovery moves only inaccessible titles and explains the reason', async () => {
  const f = await fixture(); await f.workspace.layout.move(f.a1.id, { x: 1800, y: 400 });
  const before = f.workspace.layout.state.placements;
  const result = await f.workspace.layout.recoverDisplays(workAreas, area);
  assert.deepEqual(result, { reason: 'display-unreachable', rescued: [f.a1.id] });
  assert.deepEqual(f.workspace.layout.state.placements[f.b1.id], before[f.b1.id]);
  assert.equal(reachable(f.workspace.layout.state.placements[f.a1.id], workAreas), true);
});

test('C43b: group regions follow the primary work area, also when it grows, without moving papers', async () => {
  const f = await fixture(); const layout = f.workspace.layout;
  // A laptop panel is primary at sign-in next to an external display, then goes dark and leaves the external one.
  const panel = { x: 0, y: 0, width: 960, height: 540 }; const external = { x: 960, y: 0, width: 1920, height: 1080 };
  await layout.recoverDisplays([panel, { ...external }], { ...panel, id: 'panel', primary: true });
  assert.deepEqual(layout.state.grid.area, panel);
  const placements = layout.state.placements;
  const wide = { x: 0, y: 0, width: 1920, height: 1080 };
  await layout.recoverDisplays([wide], wide);
  assert.deepEqual(layout.state.grid.area, wide);
  assert.deepEqual(gridRegions(layout.state.grid, activeGroups(f.workspace.snapshot)).at(-1),
    { groupId: layout.state.grid.slots.at(-1), x: 960, y: 0, width: 960, height: 1080 });
  assert.deepEqual(layout.state.placements, placements);
  const revision = layout.state.revision;
  await layout.recoverDisplays([wide], { ...wide });
  assert.equal(layout.state.revision, revision);
});

test('C44: creation stops at nine; reading ten preserves data and rejects formation', async () => {
  const f = await fixture(); for (let i = 2; i < 9; i++) await f.workspace.createGroup(`Group ${i}`);
  await rejectsCode(f.workspace.createGroup('Tenth group'), 'group-limit');
  const remote = f.workspace.snapshot;
  remote.groups.push({ id: 'remote-tenth', name: 'Added offline', revision: 'r1' });
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
  await f.workspace.layout.setGroupLayer(f.a.id, 'floating', f.workspace.snapshot);
  await f.controller.escape();
  const policy = cardPolicy(f.a2, f.workspace.layout.state, f.controller.state);
  assert.equal(policy.visible, false); assert.equal(policy.layer, 'floating'); assert.equal(policy.editing, false);
});

test('C45: completed papers leave the desktop unless this device shows them, and hidden ones take part in nothing', async () => {
  const f = await fixture(); const card = id => f.workspace.snapshot.cards.find(item => item.id === id);
  const visible = id => cardPolicy(card(id), f.workspace.layout.state, f.controller.state).visible;
  await f.workspace.updateCard(f.b1.id, { completed: true }, f.b1.revision);
  assert.equal(f.workspace.layout.state.completedVisible, undefined); assert.equal(visible(f.b1.id), false, 'a fresh device hides completed papers');
  await f.workspace.layout.configure({ completedVisible: true }, f.workspace.snapshot); assert.equal(visible(f.b1.id), true);
  const shownPlan = plan(f); assert.ok(shownPlan.changes[f.b1.id], 'a shown completed paper is arranged like any other');
  await f.controller.activate({ kind: 'all' }); assert.equal(await f.controller.beginEdit(f.b1.id), true);
  await rejectsCode(f.workspace.layout.configure({ completedVisible: 'no' }, f.workspace.snapshot), 'invalid-setting');
  const revisions = f.workspace.state.revisions.length; const pending = f.workspace.pendingOperations.length;
  await f.workspace.layout.configure({ completedVisible: false }, f.workspace.snapshot);
  assert.equal(f.disk().layout.completedVisible, false);
  assert.equal(f.workspace.state.revisions.length, revisions); assert.equal(f.workspace.pendingOperations.length, pending);
  assert.equal(visible(f.b1.id), false, 'adjust mode does not summon it'); assert.equal(visible(f.a1.id), true);
  await f.controller.reconcile();
  assert.equal(f.controller.state.editingCardId, null); assert.notEqual(f.controller.state.selectedCardId, f.b1.id);
  await rejectsCode(f.controller.applyFormation(shownPlan), 'stale-plan');
  await f.controller.escape();
  assert.equal(plan(f).changes[f.b1.id], undefined, 'a hidden completed paper is left out of formations');
  await rejectsCode(stepGroup({ workspace: f.workspace, controller: f.controller, groupId: f.b.id, wallpaper: true }), 'empty-scope');
  await f.workspace.updateCard(f.a1.id, { completed: true }, f.a1.revision); assert.equal(visible(f.a1.id), false);
  await f.workspace.updateCard(f.a1.id, { completed: false }, card(f.a1.id).revision); assert.equal(visible(f.a1.id), true);
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.ok(f.workspace.layout.state.placements[f.b1.id] === undefined && f.workspace.layout.state.completedVisible === undefined,
    'resetting the desktop layout hides completed papers again');
  await f.workspace.layout.placeNew(f.workspace.snapshot, workAreas); assert.equal(visible(f.b1.id), false);
});

test('formation refuses previews after a new card or a moved card', async () => {
  const f = await fixture(); const first = plan(f);
  await f.workspace.createCard(markdown('Added after the preview'));
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
    f.workspace.saveDraft({ id: 'editor-one', cardId: f.a1.id, content: markdown('first') }),
    f.workspace.saveDraft({ id: 'editor-two', cardId: f.a1.id, content: markdown('second') }),
    f.workspace.layout.move(f.b1.id, { x: 900, y: 600 }),
  ]);
  const reopened = new Workspace(f.disk(), f.persist);
  assert.deepEqual(Object.values(reopened.state.drafts).map(draft => draft.content.text), ['first', 'second']);
  assert.equal(reopened.layout.state.placements[f.b1.id].x, 900);
});

test('C27: mobile transfer works for a card with no desktop placement', async () => {
  const f = await fixture(); const card = await f.workspace.createCard(markdown('Only on the phone'));
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

test('ending an edit discards a blank draft and blank unchanged ancestors but keeps any content', async () => {
  const f = await fixture();
  const blank = f.workspace.blankDraft(f.a.id); blank.content.text = ' \n\t';
  await f.workspace.saveDraft(blank);
  assert.equal(await f.workspace.discardUnneededDraft(blank.id), true);
  assert.equal(f.workspace.state.drafts[blank.id], undefined); assert.equal(f.disk().drafts[blank.id], undefined);
  assert.equal(await f.workspace.discardUnneededDraft('missing-draft'), false);
  const kept = [];
  for (const content of [markdown('Keep this sentence'), { ...markdown(''), attachments: [{ id: 'blob-a', name: 'a.png' }] }, { ...markdown(''), title: 'Title' }]) {
    const draft = f.workspace.blankDraft(f.a.id); draft.content = content; await f.workspace.saveDraft(draft); kept.push(draft.id);
  }
  const revision = f.disk().revision;
  for (const id of kept) assert.equal(await f.workspace.discardUnneededDraft(id), false);
  assert.equal(f.disk().revision, revision, 'kept drafts must not cause another write');
  assert.deepEqual(Object.keys(f.workspace.state.drafts).sort(), [...kept].sort());
  const late = f.workspace.blankDraft(f.a.id); await f.workspace.saveDraft(late);
  const typing = f.workspace.saveDraft({ ...late, content: markdown('Just typed') });
  assert.equal(await f.workspace.discardUnneededDraft(late.id), false, 'a queued text save wins over the discard');
  await typing; assert.equal(f.workspace.state.drafts[late.id].content.text, 'Just typed');
  for (const originalText of ['', 'Original content']) {
    const g = await fixture(); const original = g.workspace.blankDraft(g.a.id); original.content.text = originalText;
    await g.workspace.saveDraft(original);
    const recovered = g.workspace.recoverDraft(original.id); recovered.content.text = '';
    await g.workspace.saveDraft(recovered);
    assert.equal(await g.workspace.discardUnneededDraft(recovered.id), true);
    assert.deepEqual(Object.keys(g.workspace.state.drafts), originalText ? [original.id] : []);
  }
});

test('ending an edit discards an unchanged copy of its card but keeps edits and copies of an older revision', async () => {
  const f = await fixture();
  const unchanged = f.workspace.blankDraft(f.a.id, f.a1); await f.workspace.saveDraft(unchanged);
  const edited = f.workspace.blankDraft(f.a.id, f.a2); edited.content.text = 'Edited content'; await f.workspace.saveDraft(edited);
  assert.equal(await f.workspace.discardUnneededDraft(unchanged.id), true);
  assert.equal(await f.workspace.discardUnneededDraft(edited.id), false);
  const stale = f.workspace.blankDraft(f.b.id, f.b1); await f.workspace.saveDraft(stale);
  await f.workspace.updateCard(f.b1.id, { content: markdown('Edited on another device') }, f.b1.revision);
  assert.equal(await f.workspace.discardUnneededDraft(stale.id), false, 'a copy of an older revision is kept');
  const bare = await f.workspace.createCard({ format: 'markdown', text: 'No attachments field' }, f.a.id);
  const opened = f.workspace.blankDraft(f.a.id, bare); opened.content.attachments ||= []; await f.workspace.saveDraft(opened);
  assert.equal(await f.workspace.discardUnneededDraft(opened.id), true, 'a missing attachments list equals an empty one');
  assert.deepEqual(Object.keys(f.workspace.state.drafts).sort(), [edited.id, stale.id].sort());
  const first = f.workspace.blankDraft(f.a.id, bare); first.content.attachments = []; await f.workspace.saveDraft(first);
  const resumed = f.workspace.recoverDraft(first.id); await f.workspace.saveDraft(resumed);
  assert.equal(await f.workspace.discardUnneededDraft(resumed.id), true);
  assert.equal(f.workspace.state.drafts[first.id], undefined, 'an unchanged ancestor copy goes with it');
});

test('every way out of editing releases the draft unless the edit is handed to another editor', async () => {
  const f = await fixture(); const released = [];
  const controller = new InteractionController({ getSnapshot: () => f.workspace.snapshot, layout: f.workspace.layout,
    commands: f.workspace, saveDraft: async () => {}, releaseDraft: async id => { released.push(id); } });
  await controller.activate({ kind: 'all' });
  await controller.beginEdit(f.a1.id); await controller.endEdit();
  await controller.beginEdit(f.a1.id); await controller.endEdit({ keepDraft: true });
  await controller.beginEdit(f.a1.id); await controller.select(f.a2.id);
  await controller.beginEdit(f.a2.id); await controller.applyFormation(plan(f));
  await controller.beginEdit(f.b1.id); await controller.activate({ kind: 'none' });
  await controller.activate({ kind: 'all' }); await controller.beginEdit(f.a2.id); await controller.escape();
  await controller.beginEdit(f.a1.id); await f.workspace.updateCard(f.a1.id, { deleted: true }, f.a1.revision); await controller.reconcile();
  assert.deepEqual(released, [f.a1.id, f.a1.id, f.a2.id, f.b1.id, f.a2.id, f.a1.id]);
  assert.equal(controller.state.editingCardId, null);
});
