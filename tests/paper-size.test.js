import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../src/core/contracts.js';
import { Workspace } from '../src/core/workspace.js';
import { CombinedWorkspace } from '../src/core/combined-workspace.js';
import { newPaperSize, paperDimensions } from '../src/layout/paper-size.js';

const area = { x: 0, y: 0, width: 1200, height: 1000 };
const content = text => ({ format: 'markdown', text, attachments: [] });
const dimensions = rect => ({ width: rect.width, height: rect.height });
const sizes = { small: { width: 160, height: 160 }, medium: { width: 240, height: 240 }, tall: { width: 240, height: 400 } };

async function fixture(workArea = area) {
  let saved; let fail = false;
  const persist = async state => { if (fail) throw new Error('disk full'); saved = copy(state); };
  const workspace = await Workspace.create({ profileId: 'local', deviceId: 'device', area: workArea, persist });
  const group = workspace.snapshot.groups[0].id;
  await workspace.layout.configure({ grid: { rows: 1, columns: 1, slots: [group], area: workArea } }, workspace.snapshot);
  const add = async () => {
    const note = await workspace.createCard(content('Synthetic size check'), group);
    await workspace.layout.placeNew(workspace.working, [workArea]); return note.id;
  };
  return { workspace, group, add, saved: () => copy(saved), persist, fail: value => { fail = value; } };
}

test('a fresh desktop starts at medium, including a saved layout with no size preference', async () => {
  const { workspace, add } = await fixture();
  assert.equal(newPaperSize(workspace.layout.state), 'medium');
  const id = await add();
  assert.deepEqual(dimensions(workspace.layout.state.placements[id]), sizes.medium);
  for (const value of ['unknown', 'toString', {}, 160, null]) {
    assert.equal(newPaperSize({ newPaperSize: value }), 'medium');
    assert.deepEqual(paperDimensions({ newPaperSize: value }), sizes.medium);
  }
});

for (const [name, size] of Object.entries(sizes)) {
  test(`${name} affects new desktop placements, keeps older geometry, and survives reopening`, async () => {
    const { workspace, add, saved, persist } = await fixture();
    const oldId = await add(); const original = workspace.layout.state.placements[oldId];
    await workspace.layout.configure({ newPaperSize: name }, workspace.snapshot);
    const freshId = await add();
    assert.deepEqual(dimensions(workspace.layout.state.placements[freshId]), size);
    assert.deepEqual(workspace.layout.state.placements[oldId], original);
    const reopened = new Workspace(saved(), persist);
    assert.equal(newPaperSize(reopened.layout.state), name);
    const note = await reopened.createCard(content('After restart'), workspace.snapshot.groups[0].id);
    await reopened.layout.placeNew(reopened.working, [area]);
    assert.deepEqual(dimensions(reopened.layout.state.placements[note.id]), size);
    assert.deepEqual(reopened.layout.state.placements[oldId], original);
  });
}

test('a queued preference change is used by the next placement', async () => {
  const { workspace, group } = await fixture();
  const note = await workspace.createCard(content('Queued'), group);
  const configured = workspace.layout.configure({ newPaperSize: 'tall' }, workspace.snapshot);
  const placed = workspace.layout.placeNew(workspace.working, [area]);
  await Promise.all([configured, placed]);
  assert.deepEqual(dimensions(workspace.layout.state.placements[note.id]), sizes.tall);
});

test('unsupported preferences and a failed save preserve the last saved choice and placed notes', async () => {
  const f = await fixture(); await f.add();
  await f.workspace.layout.configure({ newPaperSize: 'small' }, f.workspace.snapshot);
  const before = f.saved();
  for (const value of ['large', 'toString', 240, null, { width: 240, height: 400 }]) {
    await assert.rejects(f.workspace.layout.configure({ newPaperSize: value }, f.workspace.snapshot), { code: 'invalid-setting' });
    assert.deepEqual(f.saved(), before);
  }
  f.fail(true);
  await assert.rejects(f.workspace.layout.configure({ newPaperSize: 'tall' }, f.workspace.snapshot), /disk full/);
  assert.deepEqual(f.workspace.state, before);
});

test('a tall paper fits proportionally and retains the 160 shortest-side floor', async () => {
  for (const [height, expected] of [[324, { width: 180, height: 300 }], [224, { width: 160, height: 266 }]]) {
    const f = await fixture({ ...area, width: 400, height });
    await f.workspace.layout.configure({ newPaperSize: 'tall' }, f.workspace.snapshot);
    const id = await f.add();
    assert.deepEqual(dimensions(f.workspace.layout.state.placements[id]), expected);
  }
});

test('an explicit layout reset keeps the preference and re-places notes at the selected size', async () => {
  const f = await fixture(); const id = await f.add();
  await f.workspace.layout.configure({ newPaperSize: 'small' }, f.workspace.snapshot);
  await f.workspace.layout.reset(f.workspace.snapshot, area);
  assert.equal(newPaperSize(f.workspace.layout.state), 'small');
  await f.workspace.layout.placeNew(f.workspace.working, [area]);
  assert.deepEqual(dimensions(f.workspace.layout.state.placements[id]), sizes.small);
});

async function combinedFixture() {
  const profiles = [];
  for (const id of ['google:account', 'local']) {
    const values = new Map();
    const storage = { getControl: async key => copy(values.get(key) ?? null), putControl: async (key, value) => { values.set(key, copy(value)); } };
    const workspace = await Workspace.create({ profileId: id, deviceId: 'device', area, persist: async () => {} });
    profiles.push({ id, workspace, storage, values });
  }
  const combined = await CombinedWorkspace.open(profiles);
  await combined.layout.configure({ grid: { rows: 1, columns: 2, slots: profiles.map(profile => profile.workspace.snapshot.groups[0].id), area } }, combined.snapshot);
  return { combined, profiles };
}

test('one device preference serves cloud and local notes without changing sync content, and survives account closure', async () => {
  const { combined, profiles } = await combinedFixture();
  const before = profiles.map(profile => profile.workspace.state);
  await combined.layout.configure({ newPaperSize: 'tall' }, combined.snapshot);
  for (const [i, profile] of profiles.entries()) {
    assert.deepEqual(profile.workspace.state, before[i], 'the preference creates no content revision or outbox entry');
    assert.equal(profile.values.get('desk').newPaperSize, 'tall');
    const group = profile.workspace.snapshot.groups[0].id;
    const note = await profile.workspace.createCard(content('New note in either collection'), group);
    await combined.layout.placeNew(combined.working, [area]);
    assert.deepEqual(dimensions(combined.layout.state.placements[note.id]), sizes.tall);
  }
  const reopened = await CombinedWorkspace.open(profiles.slice(1));
  assert.equal(newPaperSize(reopened.layout.state), 'tall');
  const anotherDevice = await fixture();
  assert.equal(newPaperSize(anotherDevice.workspace.layout.state), 'medium');
});

test('a newly received cloud note uses this desk choice and changing it does not resize already placed papers', async () => {
  const { combined, profiles } = await combinedFixture();
  const cloud = profiles[0].workspace; const group = cloud.snapshot.groups[0].id;
  const old = await cloud.createCard(content('Already placed'), group);
  await combined.layout.placeNew(combined.working, [area]);
  const original = combined.layout.state.placements[old.id];
  await combined.layout.configure({ newPaperSize: 'small' }, combined.snapshot);
  const arrived = await cloud.adoptCard({ id: 'received-note', groupId: group, content: content('From another device'), archived: false, completed: false });
  await combined.layout.placeNew(combined.working, [area]);
  assert.deepEqual(dimensions(combined.layout.state.placements[arrived.id]), sizes.small);
  assert.deepEqual(combined.layout.state.placements[old.id], original);
  await assert.rejects(combined.layout.configure({ newPaperSize: 'large' }, combined.snapshot), { code: 'invalid-setting' });
  await combined.layout.reset(combined.snapshot, area);
  await combined.layout.placeNew(combined.working, [area]);
  assert.equal(newPaperSize(combined.layout.state), 'small');
  assert.deepEqual(dimensions(combined.layout.state.placements[old.id]), sizes.small);
});
