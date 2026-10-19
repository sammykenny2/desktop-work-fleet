import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy } from '../src/core/contracts.js';
import { resolveGroupId } from '../src/core/groups.js';

const area = { x: 0, y: 0, width: 1200, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [{ id: 'blob', name: 'original.txt' }], custom: { keep: true } });
async function fixture() {
  let disk; let failed = false;
  const persist = async (state, revision) => {
    if (failed) throw new Error('disk full');
    assert.equal(disk?.revision ?? null, revision); disk = copy(state);
  };
  const workspace = await Workspace.create({ profileId: 'test', deviceId: 'test-device', area, persist });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('B');
  const cards = [];
  for (const text of ['active', 'completed', 'archived', 'deleted']) {
    let card = await workspace.createCard(content(text), a.id);
    if (text !== 'active') card = await workspace.updateCard(card.id, { [text]: true }, card.revision);
    cards.push(card);
  }
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  return { workspace, a, b, cards, persist, disk: () => copy(disk), fail: value => { failed = value; } };
}

test('group merge previews every state, atomically redirects membership and preserves content and geometry', async () => {
  const f = await fixture();
  await f.workspace.layout.configure({ myGroupId: f.a.id, shortcuts: { 'Ctrl+Shift+1': f.a.id } }, f.workspace.snapshot);
  const before = f.disk(); const plan = f.workspace.previewGroupMerge(f.a.id, f.b.id);
  assert.equal(plan.cards.length, 4); assert.equal(plan.cards.filter(card => card.deleted).length, 1);
  assert.deepEqual(f.disk(), before, 'preview does not write');
  f.fail(true); await assert.rejects(f.workspace.mergeGroup(plan), /disk full/);
  assert.deepEqual(f.disk(), before); assert.deepEqual(f.workspace.state, before);
  f.fail(false); await f.workspace.mergeGroup(plan);
  assert.deepEqual(f.workspace.layout.state.placements, before.layout.placements);
  assert.equal(f.workspace.layout.state.myGroupId, f.b.id);
  assert.equal(f.workspace.layout.state.shortcuts['Ctrl+Shift+1'], f.b.id);
  assert.deepEqual(f.workspace.layout.state.grid.slots, before.layout.grid.slots.map(id => id === f.a.id ? null : id));
  for (const previous of before.cards) {
    const current = f.workspace.snapshot.cards.find(card => card.id === previous.id);
    assert.deepEqual(current, { ...previous, groupId: f.b.id, revision: current.revision });
    assert.notEqual(current.revision, previous.revision);
  }
  const source = f.workspace.snapshot.groups.find(group => group.id === f.a.id);
  assert.equal(source.deleted, true); assert.equal(source.redirectGroupId, f.b.id);
  assert.equal(f.workspace.state.outbox.length, before.outbox.length + 5);
  assert.equal(resolveGroupId(f.workspace.state, f.a.id), f.b.id);
  const lateCapture = await f.workspace.createCard(content('late capture'), f.a.id);
  assert.equal(lateCapture.groupId, f.b.id);
  const deleted = f.workspace.snapshot.cards.find(card => card.deleted);
  const restored = await f.workspace.restoreCard(deleted.id, deleted.revision);
  assert.equal(restored.groupId, f.b.id); assert.equal(restored.deleted, false);
});

test('group merge refuses stale source membership, content, draft and destination previews without a partial write', async () => {
  for (const change of ['capture', 'content', 'draft', 'target']) {
    const f = await fixture(); const plan = f.workspace.previewGroupMerge(f.a.id, f.b.id);
    if (change === 'capture') await f.workspace.createCard(content('new'), f.a.id);
    if (change === 'content') await f.workspace.updateCard(f.cards[0].id, { content: content('changed') }, f.cards[0].revision);
    if (change === 'draft') await f.workspace.saveDraft(f.workspace.blankDraft(f.a.id));
    if (change === 'target') await f.workspace.renameGroup(f.b.id, 'renamed', f.b.revision);
    const before = f.disk();
    await assert.rejects(f.workspace.mergeGroup(plan), error => error.code === 'stale-group-plan');
    assert.deepEqual(f.disk(), before); assert.deepEqual(f.workspace.layout.state, before.layout);
  }
});

test('group merge rebases unchanged draft revisions and every lineage baseline without losing separate edits', async () => {
  const f = await fixture();
  const original = f.workspace.blankDraft(f.a.id, f.cards[0]); original.content.text = 'first draft';
  await f.workspace.saveDraft(original);
  const first = f.workspace.recoverDraft(original.id); first.content.text = 'second draft'; await f.workspace.saveDraft(first);
  const second = f.workspace.recoverDraft(first.id); second.content.text = 'final draft'; await f.workspace.saveDraft(second);
  original.content.text = 'independent draft'; await f.workspace.saveDraft(original);
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.a.id, f.b.id));
  const saved = await f.workspace.commitDraft(second.id);
  assert.equal(saved.groupId, f.b.id); assert.equal(saved.content.text, 'final draft');
  assert.deepEqual(Object.keys(f.workspace.state.drafts), [original.id]);
  assert.equal(f.workspace.state.drafts[original.id].groupId, f.b.id);
  assert.equal(f.workspace.state.drafts[original.id].content.text, 'independent draft');
});

test('retired groups clear only incompatible transfer undo and preserve later geometry undo', async () => {
  const f = await fixture(); const card = f.cards[0];
  await f.workspace.transferCard({ cardId: card.id, groupId: f.b.id, expectedRevision: card.revision });
  const beforeMove = f.workspace.layout.state.placements[card.id];
  await f.workspace.layout.move(card.id, { x: 400, y: 300 });
  const plan = f.workspace.previewGroupMerge(f.a.id, f.b.id);
  await f.workspace.mergeGroup(plan);
  assert.deepEqual(f.workspace.layout.state.history.map(entry => entry.kind), ['move']);
  await f.workspace.undo([area]);
  assert.deepEqual(f.workspace.layout.state.placements[card.id], beforeMove);
});

test('empty group merge still commits when the device has not assigned that group a region', async () => {
  const f = await fixture(); const empty = await f.workspace.createGroup('not placed yet');
  const result = await f.workspace.mergeGroup(f.workspace.previewGroupMerge(empty.id, f.b.id));
  assert.equal(result.movedCards, 0);
  assert.equal(f.workspace.snapshot.groups.find(group => group.id === empty.id).deleted, true);
  assert.deepEqual(f.workspace.layout.state, f.disk().layout);
});

test('group redirects resolve chains but reject cycles, missing dependencies and self merge', async () => {
  const f = await fixture();
  assert.throws(() => f.workspace.previewGroupMerge(f.a.id, f.a.id), error => error.code === 'same-group');
  const c = await f.workspace.createGroup('C');
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.a.id, f.b.id));
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.b.id, c.id));
  assert.equal(resolveGroupId(f.workspace.state, f.a.id), c.id);
  const cyclic = { groups: [{ id: 'a', deleted: true, redirectGroupId: 'b' }, { id: 'b', deleted: true, redirectGroupId: 'a' }] };
  assert.throws(() => resolveGroupId(cyclic, 'a'), error => error.code === 'group-cycle');
  assert.throws(() => resolveGroupId({ groups: [] }, 'a'), error => error.code === 'missing-group');
});

test('autosave queued during a merge follows only proven membership revisions and preserves text conflicts', async () => {
  for (const editAfterMerge of [false, true]) {
    const f = await fixture(); let release; let entered;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let block = false;
    const workspace = new Workspace(f.disk(), async (state, revision) => {
      if (block) { block = false; entered(); await gate; }
      await f.persist(state, revision);
    });
    const draft = workspace.blankDraft(f.a.id, f.cards[0]); draft.content.text = 'first input';
    await workspace.saveDraft(draft);
    const plan = workspace.previewGroupMerge(f.a.id, f.b.id); block = true;
    const merge = workspace.mergeGroup(plan); await enteredPromise;
    draft.content.text = 'input received while saving merge';
    const pending = workspace.saveDraft(draft); release(); await merge; await pending;
    const persisted = workspace.state.drafts[draft.id];
    assert.equal(persisted.groupId, f.b.id); assert.notEqual(persisted.baseRevision, draft.baseRevision);
    assert.equal(persisted.content.text, 'input received while saving merge');
    if (editAfterMerge) {
      const head = workspace.snapshot.cards.find(card => card.id === draft.cardId);
      await workspace.updateCard(head.id, { content: content('independent shared edit') }, head.revision);
    }
    const c = await workspace.createGroup('C');
    await workspace.mergeGroup(workspace.previewGroupMerge(f.b.id, c.id));
    draft.content.text = 'last old editor input'; await workspace.saveDraft(draft);
    const savedDraft = workspace.state.drafts[draft.id];
    assert.equal(savedDraft.groupId, c.id); assert.equal(savedDraft.content.text, 'last old editor input');
    if (editAfterMerge) {
      await assert.rejects(workspace.commitDraft(draft.id), error => error.code === 'conflict');
      assert.equal(workspace.snapshot.cards.find(card => card.id === draft.cardId).content.text, 'independent shared edit');
    } else {
      const saved = await workspace.commitDraft(draft.id);
      assert.equal(saved.content.text, draft.content.text); assert.equal(saved.groupId, c.id);
    }
  }
});

test('queued old settings cannot reintroduce retired group references after merge', async () => {
  const f = await fixture(); const oldSnapshot = f.workspace.snapshot;
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge(f.a.id, f.b.id));
  const before = f.disk();
  await assert.rejects(f.workspace.layout.configure({ myGroupId: f.a.id }, oldSnapshot), error => error.code === 'stale-groups');
  await assert.rejects(f.workspace.layout.placeNew(oldSnapshot, [area]), error => error.code === 'stale-groups');
  assert.deepEqual(f.disk(), before); assert.deepEqual(f.workspace.layout.state, before.layout);
});

test('saving an unchanged group name records no revision to sync and still checks the expected revision', async () => {
  const f = await fixture();
  const revisions = f.workspace.state.revisions.length; const pending = f.workspace.pendingOperations.length;
  assert.deepEqual(await f.workspace.renameGroup(f.b.id, '  B ', f.b.revision), f.b);
  assert.equal(f.workspace.state.revisions.length, revisions); assert.equal(f.workspace.pendingOperations.length, pending);
  const renamed = await f.workspace.renameGroup(f.b.id, 'Renamed', f.b.revision);
  assert.notEqual(renamed.revision, f.b.revision); assert.equal(f.workspace.pendingOperations.length, pending + 1);
  await assert.rejects(f.workspace.renameGroup(f.b.id, 'Renamed', f.b.revision), error => error.code === 'conflict');
});
