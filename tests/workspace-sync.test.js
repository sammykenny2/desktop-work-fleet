import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { activeGroups, copy, gridRegions } from '../src/core/contracts.js';
import { revisionRecord, RevisionGraph } from '../src/sources/revisions.js';
import { resolveGroupId } from '../src/core/groups.js';
import { arrivalLayer, groupLayer } from '../src/layout/stages.js';

const area = { x: 0, y: 0, width: 1400, height: 900 };
const content = text => ({ format: 'markdown', text, attachments: [{ id: 'blob', name: 'kept.txt', size: 10 }], extra: { keep: true } });
const fails = code => error => error.code === code;
async function fixture() {
  let disk; let fail = false;
  const persist = async (state, revision) => {
    if (fail) throw new Error('disk full');
    assert.equal(disk?.revision ?? null, revision); disk = copy(state);
  };
  const workspace = await Workspace.create({ profileId: 'account-a', deviceId: 'device-a', area, persist });
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('B');
  const card = await workspace.createCard(content('original'), a.id);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  const session = await workspace.beginSync('drive:account-a:app-data');
  const receive = records => workspace.receiveRevisions(records,
    { session, expectedCursor: workspace.state.sync.cursor, cursor: crypto.randomUUID() });
  return { workspace, a, b, card, session, receive, persist, disk: () => copy(disk), fail: value => { fail = value; } };
}
const branch = (card, revision, text, patch = {}) => revisionRecord('card',
  { ...card, revision, content: content(text), ...patch }, [card.revision]);
const groupBranch = (group, revision, patch) => revisionRecord('group', { ...group, revision, ...patch }, [group.revision]);

test('remote data, conflict projection, device references and cursor commit together or all roll back', async () => {
  const f = await fixture();
  await f.workspace.layout.configure({ myGroupId: f.a.id, shortcuts: { 'Ctrl+1': f.a.id } }, f.workspace.snapshot);
  const draft = f.workspace.blankDraft(f.a.id, f.card); draft.content.text = 'unsaved independent edit';
  await f.workspace.saveDraft(draft);
  const records = [groupBranch(f.a, 'retire-a', { deleted: true, redirectGroupId: f.b.id }), branch(f.card, 'remote', 'new text')];
  const before = f.disk(); f.fail(true);
  await assert.rejects(f.receive(records), /disk full/);
  assert.deepEqual(f.workspace.state, before); assert.deepEqual(f.disk(), before);
  assert.deepEqual(f.workspace.layout.state, before.layout);
  assert.equal(f.workspace.revisionHeads('card', f.card.id)[0].revisionId, f.card.revision);
  f.fail(false); await f.receive(records);
  const after = f.disk();
  assert.equal(after.cards[0].content.text, 'new text'); assert.equal(after.cards[0].groupId, f.b.id);
  assert.equal(after.layout.myGroupId, f.b.id); assert.equal(after.layout.shortcuts['Ctrl+1'], f.b.id);
  assert.deepEqual(after.layout.placements, before.layout.placements);
  assert.deepEqual(after.drafts, before.drafts); assert.deepEqual(after.outbox, before.outbox);
  assert.notEqual(after.sync.cursor, before.sync.cursor); assert.deepEqual(f.workspace.layout.state, after.layout);
  const reopened = new Workspace(after, f.persist);
  assert.deepEqual(reopened.snapshot, f.workspace.snapshot);
  assert.equal(reopened.revisionHeads('card', f.card.id)[0].value.groupId, f.a.id, 'wire membership is immutable; projection follows redirect');
});

test('offline branches block ordinary overwrite, preserve drafts and resolve all observed heads explicitly', async () => {
  const f = await fixture(); const draft = f.workspace.blankDraft(f.a.id, f.card);
  draft.content.text = 'local draft'; await f.workspace.saveDraft(draft);
  const local = await f.workspace.updateCard(f.card.id, { content: content('local saved') }, f.card.revision);
  await f.receive([branch(f.card, 'remote', 'remote saved', { deleted: true })]);
  const before = f.disk(); const heads = f.workspace.revisionHeads('card', f.card.id).map(item => item.revisionId);
  assert.equal(heads.length, 2); assert.equal(f.workspace.snapshot.cards[0].revision, local.revision);
  await assert.rejects(f.workspace.updateCard(f.card.id, { completed: true }, local.revision), fails('conflict'));
  await assert.rejects(f.workspace.commitDraft(draft.id), fails('conflict'));
  assert.deepEqual(f.disk(), before);
  f.fail(true);
  await assert.rejects(f.workspace.resolveRevisions({ kind: 'card', entityId: f.card.id, heads,
    selectedRevision: local.revision, patch: { content: content('combined') } }), /disk full/);
  assert.deepEqual(f.disk(), before); f.fail(false);
  const result = await f.workspace.resolveRevisions({ kind: 'card', entityId: f.card.id, heads,
    selectedRevision: local.revision, patch: { content: content('combined') } });
  assert.equal(result.content.text, 'combined'); assert.equal(f.workspace.state.conflicts.length, 0);
  assert.deepEqual(f.workspace.state.outbox.at(-1).parents, heads);
  assert.deepEqual(f.workspace.state.drafts, before.drafts);
  assert.deepEqual(f.workspace.layout.state.placements, before.layout.placements);
  await f.receive([branch(f.card, 'late-third', 'third device')]);
  assert.equal(f.workspace.revisionHeads('card', f.card.id).length, 2);
  assert.ok(f.workspace.state.conflicts.some(item => item.kind === 'revision'));
});

test('a stale conflict decision or duplicate head list cannot consume a new branch', async () => {
  const f = await fixture();
  await f.receive([branch(f.card, 'a', 'A'), branch(f.card, 'b', 'B')]);
  const heads = f.workspace.revisionHeads('card', f.card.id).map(item => item.revisionId);
  await f.receive([branch(f.card, 'c', 'C')]); const before = f.disk();
  for (const expected of [heads, ['a', 'b', 'c', 'c']]) {
    await assert.rejects(f.workspace.resolveRevisions({ kind: 'card', entityId: f.card.id,
      heads: expected, selectedRevision: 'a' }), fails('stale-resolution'));
    assert.deepEqual(f.disk(), before);
  }
});

test('late source sessions, wrong account and stale cursors leave every local field unchanged', async () => {
  const f = await fixture(); const replacement = await f.workspace.beginSync(f.session.sourceId);
  const before = f.disk();
  const options = { session: f.session, expectedCursor: null, cursor: 'next' };
  await assert.rejects(f.workspace.receiveRevisions([branch(f.card, 'remote', 'remote')], options), fails('stale-session'));
  await assert.rejects(f.workspace.receiveRevisions([], { ...options, session: { ...replacement, profileId: 'account-b' } }), fails('stale-session'));
  await assert.rejects(f.workspace.receiveRevisions([], { ...options, session: replacement, expectedCursor: 'stale' }), fails('stale-cursor'));
  await assert.rejects(f.workspace.beginSync('drive:account-b:app-data'), fails('source-mismatch'));
  assert.deepEqual(f.disk(), before);
  await f.workspace.endSync(replacement); const ended = f.disk();
  await assert.rejects(f.workspace.receiveRevisions([], { ...options, session: replacement }), fails('stale-session'));
  assert.deepEqual(f.disk(), ended);
});

test('pending revisions survive reopening and missing groups become visible when their dependency arrives', async () => {
  const f = await fixture(); const record = branch(f.card, 'child', 'new', { groupId: 'missing-group' });
  record.parents = ['unknown'];
  await f.receive([record]);
  assert.equal(f.workspace.snapshot.cards[0].revision, f.card.revision);
  assert.ok(f.workspace.state.conflicts.some(item => item.kind === 'pending-revisions'));
  const reopened = new Workspace(f.disk(), f.persist);
  assert.equal(reopened.state.revisions.some(item => item.revisionId === 'child'), true);
  await f.receive([branch(f.card, 'unknown', 'parent')]);
  assert.equal(f.workspace.snapshot.cards[0].groupId, 'missing-group');
  assert.ok(f.workspace.state.conflicts.some(item => item.kind === 'card-group'));
  await f.receive([revisionRecord('group', { id: 'missing-group', revision: 'group-root', name: 'Arrived', deleted: false })]);
  assert.equal(f.workspace.state.conflicts.length, 0);
  assert.equal(f.workspace.snapshot.cards[0].content.text, 'new');
});

test('concurrent opposite group retirements preserve all data, permit draft saves and explicit cycle repair', async () => {
  const f = await fixture(); const draft = f.workspace.blankDraft(f.a.id, f.card);
  await f.workspace.saveDraft(draft); const before = f.disk();
  await f.receive([
    groupBranch(f.a, 'retire-a', { deleted: true, redirectGroupId: f.b.id }),
    groupBranch(f.b, 'retire-b', { deleted: true, redirectGroupId: f.a.id }),
  ]);
  assert.equal(f.workspace.snapshot.groups.filter(group => !group.deleted).length, 0);
  assert.ok(f.workspace.state.conflicts.some(item => item.reason === 'group-cycle'));
  draft.content.text = 'typed during cycle'; await f.workspace.saveDraft(draft);
  assert.equal(f.workspace.state.drafts[draft.id].content.text, 'typed during cycle');
  assert.deepEqual(f.workspace.layout.state.placements, before.layout.placements);
  await f.workspace.resolveRevisions({ kind: 'group', entityId: f.b.id, heads: ['retire-b'], selectedRevision: 'retire-b', patch: { deleted: false } });
  assert.equal(resolveGroupId(f.workspace.snapshot, f.a.id), f.b.id);
  assert.equal(f.workspace.state.conflicts.length, 0);
  assert.equal(f.workspace.snapshot.cards[0].groupId, f.b.id);
  await f.workspace.saveDraft(draft);
  assert.equal(f.workspace.state.drafts[draft.id].groupId, f.b.id);
  await f.workspace.commitDraft(draft.id);
  assert.equal(f.workspace.snapshot.cards[0].content.text, 'typed during cycle');
});

test('ten concurrent groups are retained, can be merged to nine and cannot be overwritten by stale device settings', async () => {
  const f = await fixture(); const oldSnapshot = f.workspace.snapshot;
  const records = Array.from({ length: 8 }, (_, index) => revisionRecord('group', {
    id: `group-${index}`, revision: `group-root-${index}`, name: `Group ${index}`, deleted: false,
  }));
  await f.receive(records); const before = f.disk();
  assert.equal(f.workspace.snapshot.groups.filter(group => !group.deleted).length, 10);
  assert.ok(f.workspace.state.conflicts.some(item => item.kind === 'group-overflow'));
  await assert.rejects(f.workspace.layout.configure({ myGroupId: f.a.id }, oldSnapshot), fails('stale-groups'));
  assert.deepEqual(f.disk(), before);
  await f.workspace.mergeGroup(f.workspace.previewGroupMerge('group-0', f.a.id));
  assert.equal(f.workspace.snapshot.groups.filter(group => !group.deleted).length, 9);
  assert.equal(f.workspace.state.conflicts.some(item => item.kind === 'group-overflow'), false);
  assert.equal(gridRegions(f.workspace.layout.state.grid, activeGroups(f.workspace.snapshot)).length, 9);
  assert.deepEqual(f.workspace.layout.state, f.disk().layout);
  assert.deepEqual(f.workspace.layout.state.placements, before.layout.placements);
});

test('local migration builds the same graph from full outbox, missing history refuses invented roots', async () => {
  const f = await fixture(); const old = f.disk(); delete old.revisions; delete old.sync;
  const migrated = new Workspace(old, async () => {});
  assert.equal(migrated.revisionHeads('card', f.card.id)[0].revisionId, f.card.revision);
  const broken = copy(old); broken.outbox = broken.outbox.filter(item => item.entityId !== f.card.id);
  assert.throws(() => new Workspace(broken, async () => {}), fails('incomplete-local-history'));
});

test('reopening requires a new runtime session even when the persisted source cursor can resume', async () => {
  const f = await fixture(); await f.receive([]); const before = f.disk();
  const reopened = new Workspace(before, f.persist);
  await assert.rejects(reopened.receiveRevisions([], { session: f.session, expectedCursor: before.sync.cursor, cursor: 'new' }), fails('stale-session'));
  assert.deepEqual(f.disk(), before);
  const session = await reopened.beginSync(f.session.sourceId);
  await reopened.receiveRevisions([], { session, expectedCursor: before.sync.cursor, cursor: 'new' });
  assert.equal(f.disk().sync.cursor, 'new');
});

test('historical restore creates a new all-head revision and keeps later values, draft and attachment extensions', async () => {
  const f = await fixture();
  const draft = f.workspace.blankDraft(f.a.id, f.card); await f.workspace.saveDraft(draft);
  await f.receive([branch(f.card, 'a', 'later A'), branch(f.card, 'b', 'later B', { deleted: true })]);
  const before = f.disk();
  await f.workspace.resolveRevisions({ kind: 'card', entityId: f.card.id, heads: ['a', 'b'],
    selectedRevision: f.card.revision, fromHistory: true });
  assert.deepEqual(f.workspace.snapshot.cards[0].content, f.card.content);
  assert.deepEqual(f.workspace.state.drafts, before.drafts);
  const history = f.workspace.revisionHistory('card', f.card.id);
  assert.equal(history.length, 4); assert.deepEqual(history[0].parents, ['a', 'b']);
  assert.deepEqual(new Set(history.map(item => item.value.content.text)), new Set(['original', 'later A', 'later B']));
  await assert.rejects(f.workspace.resolveRevisions({ kind: 'card', entityId: f.card.id,
    heads: [history[0].revisionId], selectedRevision: f.a.revision, fromHistory: true }), fails('missing-revision'));
});

test('stale transfer intents can be explicitly cleared without rewriting content or removing version conflicts', async () => {
  const f = await fixture(); await f.workspace.updateCard(f.card.id, { content: content('new') }, f.card.revision);
  await assert.rejects(f.workspace.transferCard({ cardId: f.card.id, groupId: f.b.id, expectedRevision: f.card.revision }), fails('conflict'));
  const intent = f.workspace.state.conflicts.find(item => item.kind === 'transfer');
  await f.receive([branch(f.card, 'remote', 'remote')]); const before = f.disk();
  await f.workspace.clearTransferIntent(intent);
  assert.deepEqual(f.workspace.state.cards, before.cards); assert.deepEqual(f.workspace.state.revisions, before.revisions);
  assert.ok(f.workspace.state.conflicts.some(item => item.kind === 'revision'));
  assert.equal(f.workspace.state.conflicts.some(item => item.kind === 'transfer'), false);
});

test('retrying an intent commits membership, outbox, undo and intent consumption in one fallible transaction', async () => {
  const f = await fixture(); const current = await f.workspace.updateCard(f.card.id, { content: content('new') }, f.card.revision);
  await assert.rejects(f.workspace.transferCard({ cardId: f.card.id, groupId: f.b.id, expectedRevision: f.card.revision }), fails('conflict'));
  const intent = f.workspace.state.conflicts.find(item => item.kind === 'transfer'); const before = f.disk();
  f.fail(true); await assert.rejects(f.workspace.retryTransferIntent(intent, current.revision), /disk full/);
  assert.deepEqual(f.disk(), before); assert.deepEqual(f.workspace.state, before);
  assert.deepEqual(f.workspace.layout.state, before.layout);
  f.fail(false); await f.workspace.retryTransferIntent(intent, current.revision);
  const after = f.disk();
  assert.equal(after.revision, before.revision + 1); assert.equal(after.cards[0].groupId, f.b.id);
  assert.equal(after.outbox.length, before.outbox.length + 1); assert.equal(after.layout.history.length, before.layout.history.length + 1);
  assert.deepEqual(after.layout.placements, before.layout.placements); assert.equal(after.conflicts.length, 0);
  await assert.rejects(f.workspace.retryTransferIntent(intent, current.revision), fails('missing-intent'));
  assert.deepEqual(f.disk(), after); await f.workspace.undo([area]);
  assert.equal(f.workspace.snapshot.cards[0].groupId, f.a.id); assert.equal(f.workspace.snapshot.cards[0].content.text, 'new');
});

test('malformed remote batches and local non-JSON extensions do not persist partial updates', async () => {
  const f = await fixture(); const before = f.disk();
  const bad = branch(f.card, 'bad', 'bad'); bad.parents = [f.a.revision];
  await assert.rejects(f.receive([branch(f.card, 'good', 'good'), bad]), fails('parent-identity'));
  await assert.rejects(f.workspace.createCard({ ...content('unsupported'), extra: new Map() }, f.a.id), fails('invalid-json'));
  assert.deepEqual(f.disk(), before); assert.deepEqual(f.workspace.state, before);
});

test('graph forks remain isolated when the candidate succeeds or rejects', () => {
  const root = revisionRecord('group', { id: 'g', revision: 'r', name: 'A', deleted: false });
  const original = new RevisionGraph([root]); const fork = original.fork([groupBranch(root.value, 'new', { name: 'B' })]);
  assert.equal(original.size, 1); assert.equal(fork.size, 2);
  assert.throws(() => original.fork([{ ...root, value: { ...root.value, name: 'collision' } }]), fails('revision-collision'));
  assert.equal(original.get('r').value.name, 'A'); assert.equal(fork.get('r').value.name, 'A');
});

test('cards read in creation order on every device, whatever order they were made or received in', async () => {
  // A device that made the cards and one that received them all at once in its first sync must show the same order.
  let clock = Date.UTC(2026, 9, 6, 12); const ids = ['group', 'group-root', 'late', 'late-root', 'early', 'early-root'];
  const maker = await Workspace.create({ profileId: 'maker', deviceId: 'maker', area, persist: async () => {},
    uuid: () => ids.shift() || crypto.randomUUID(), now: () => clock });
  const group = maker.snapshot.groups[0];
  const late = await maker.createCard(content('made first, but given the later time'), group.id); clock -= 60000;
  const early = await maker.createCard(content('made second, with the earlier clock'), group.id);
  assert.equal(late.createdAt, '2026-10-06T12:00:00.000Z'); assert.equal(early.createdAt, '2026-10-06T11:59:00.000Z');
  const edited = await maker.updateCard(late.id, { completed: true }, late.revision);
  assert.equal(edited.createdAt, late.createdAt);
  // Cards from before createdAt, or with a value this version does not read, come first by ID.
  const legacy = [{ id: 'old-b', createdAt: undefined }, { id: 'old-a', createdAt: 'yesterday' }].map(({ id, createdAt }) => revisionRecord('card',
    { id, revision: `${id}-root`, groupId: group.id, content: content(id), deleted: false, archived: false, completed: false, ...(createdAt && { createdAt }) }));
  const records = [...maker.state.revisions.filter(record => record.kind === 'card'), ...legacy];
  const expected = ['old-a', 'old-b', 'early', 'late'];
  for (const order of [records, [...records].reverse()]) {
    const receiver = await Workspace.create({ profileId: 'receiver', deviceId: 'receiver', area, persist: async () => {}, bootstrapGroup: false });
    const session = await receiver.beginSync('test');
    await receiver.receiveRevisions([revisionRecord('group', group), ...order], { session, expectedCursor: null, cursor: 'one' });
    assert.deepEqual(receiver.snapshot.cards.map(card => card.id), expected);
  }
  const session = await maker.beginSync('test');
  await maker.receiveRevisions(legacy, { session, expectedCursor: null, cursor: 'one' });
  assert.deepEqual(maker.snapshot.cards.map(card => card.id), expected);
  // Papers written in the editor are made from a draft.
  clock += 120000; const draft = maker.blankDraft(group.id); draft.content.text = 'from the editor';
  await maker.saveDraft(draft); await maker.commitDraft(draft.id);
  assert.equal(maker.snapshot.cards.find(card => card.content.text === 'from the editor').createdAt, '2026-10-06T12:01:00.000Z');
});

test('projection keeps established local group order when new UUIDs sort before existing ones', async () => {
  const ids = ['z-group', 'root-z', 'a-group', 'root-a'];
  const workspace = await Workspace.create({ profileId: 'test', deviceId: 'device', area,
    persist: async () => {}, uuid: () => ids.shift() || crypto.randomUUID() });
  await workspace.createGroup('New');
  assert.deepEqual(workspace.snapshot.groups.map(group => group.id), ['z-group', 'a-group']);
  const session = await workspace.beginSync('test');
  await workspace.receiveRevisions([revisionRecord('group', { id: '0-first', revision: 'root-0', name: 'Remote', deleted: false })],
    { session, expectedCursor: null, cursor: 'one' });
  assert.deepEqual(workspace.snapshot.groups.map(group => group.id), ['z-group', 'a-group', '0-first']);
  assert.deepEqual(workspace.layout.state.grid.slots, ['z-group', 'a-group', '0-first']);
});

test('a group first received from sync starts on the arrival layer, and only then', async () => {
  const f = await fixture(); f.workspace.setArrivalLayer(() => 'wallpaper');
  const remote = { id: 'remote-group', revision: 'remote-root', name: 'Remote', deleted: false };
  const retired = { id: 'retired-group', revision: 'retired-root', name: 'Retired', deleted: false };
  await f.receive([revisionRecord('group', remote), groupBranch(f.b, 'b-remote', { name: 'B elsewhere' }),
    revisionRecord('group', retired),
    groupBranch(retired, 'retired-gone', { deleted: true, redirectGroupId: f.a.id })]);
  // Groups this device already held and a group that arrives already retired get no layer.
  assert.deepEqual(f.workspace.layout.state.groupLayers, { 'remote-group': 'wallpaper' });
  assert.deepEqual(f.disk().layout, f.workspace.layout.state);
  // A layer chosen here survives later revisions of the group, and a retired group coming back is not new.
  await f.workspace.layout.setGroupLayer('remote-group', 'floating', f.workspace.snapshot);
  await f.receive([groupBranch(remote, 'remote-renamed', { name: 'Renamed' }),
    revisionRecord('group', { ...retired, revision: 'retired-back' }, ['retired-gone'])]);
  assert.equal(activeGroups(f.workspace.snapshot).some(group => group.id === 'retired-group'), true);
  assert.deepEqual(f.workspace.layout.state.groupLayers, { 'remote-group': 'floating' });
  assert.equal(groupLayer(new Workspace(f.disk(), f.persist).layout.state, 'remote-group'), 'floating');
});

test('without a wallpaper layer, or without any desktop layers, received groups keep the default desktop layer', async () => {
  for (const choose of [undefined, () => arrivalLayer(['desktop', 'floating']), () => arrivalLayer([])]) {
    const f = await fixture(); if (choose) f.workspace.setArrivalLayer(choose);
    await f.receive([revisionRecord('group', { id: 'remote-group', revision: 'remote-root', name: 'Remote', deleted: false })]);
    assert.equal(activeGroups(f.workspace.snapshot).some(group => group.id === 'remote-group'), true);
    assert.deepEqual(f.workspace.layout.state.groupLayers, {});
    assert.equal(groupLayer(f.workspace.layout.state, 'remote-group'), 'desktop');
  }
});
