import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/core/workspace.js';
import { copy } from '../src/core/contracts.js';
import { canonicalJson, parseJson } from '../src/sources/json.js';
import { revisionRecord } from '../src/sources/revisions.js';
import { sha256 } from '../src/sources/files.js';
import { packZip, unpackZip } from '../src/backup/archive.js';
import { BackupDocument, createBackup, openBackup } from '../src/backup/payload.js';

const encode = value => new TextEncoder().encode(canonicalJson(value));
const fails = code => error => error.code === code;
const area = { x: -1200, y: 0, width: 1200, height: 800 };
const now = () => new Date('2026-10-04T06:07:08.000Z');
const options = { now, uuid: () => 'backup-id', appVersion: '1.0.0' };

async function fixture() {
  let disk; let writes = 0; let sequence = 0; const reads = [];
  const workspace = await Workspace.create({ profileId: 'private-profile-a', deviceId: 'device-a', area,
    uuid: () => `id-${++sequence}`, persist: async (state, revision) => {
      assert.equal(disk?.revision ?? null, revision); disk = copy(state); writes++;
    } });
  const bytes = new TextEncoder().encode('attachment 中文 💡\u0000<svg onload="alert(1)">'); const id = await sha256(bytes);
  const blobs = new Map([[id, new Blob([bytes])]]);
  const storage = { getAttachment: async (profile, key) => {
    reads.push([profile, key]); assert.equal(profile, 'private-profile-a'); return blobs.get(key) ?? null;
  } };
  const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('Group B');
  const content = { format: 'markdown', title: '', text: '# 中文 💡\n- [x] Done\n- [ ] Not done\n',
    attachments: [{ id, name: '../名字.svg', mediaType: 'image/svg+xml', size: bytes.length, extension: { retained: true } }],
    unknown: { nested: ['preserved', false, null] } };
  const card = await workspace.createCard(content, a.id);
  await workspace.updateCard(card.id, { completed: true, archived: true }, card.revision);
  const deleted = await workspace.createCard({ format: 'future-rich-format', text: 'Recoverable deletion', opaque: [1, 2] }, b.id);
  await workspace.updateCard(deleted.id, { deleted: true }, deleted.revision);
  await workspace.layout.placeNew(workspace.snapshot, [area]);
  await workspace.layout.setCardPolicy(card.id, { visible: false });
  await workspace.layout.setGroupLayer(b.id, 'wallpaper', workspace.snapshot);
  await workspace.layout.configure({ myGroupId: a.id, completedVisible: false, quickMove: true, shortcuts: { 'Ctrl+1': a.id, 'Ctrl+2': '@capture' } },
    workspace.snapshot);
  await workspace.layout.setMainGroup(a.id, workspace.snapshot);
  const draft = workspace.blankDraft(a.id, workspace.snapshot.cards.find(item => item.id === card.id));
  draft.content.text = 'Unsaved original'; await workspace.saveDraft(draft);
  const recovered = { ...copy(draft), id: 'recovered-draft', content: { ...content, text: 'Recovered branch' },
    recoveredFrom: [{ id: draft.id, baseline: JSON.stringify(draft) }] };
  await workspace.saveDraft(recovered);
  const blank = workspace.blankDraft(b.id); blank.content.text = 'Never became a note'; await workspace.saveDraft(blank);
  await workspace.mergeGroup(workspace.previewGroupMerge(a.id, b.id));
  return { workspace, storage, blobs, bytes, id, card, a, b, reads, disk: () => copy(disk), writes: () => writes,
    export: overrides => createBackup({ workspace, storage, ...options, ...overrides }) };
}

async function change(zip, mutate, { rehash = true } = {}) {
  const files = await unpackZip(zip); const manifest = parseJson(files.get('manifest.json'));
  await mutate(files, manifest);
  if (rehash) {
    manifest.files = [];
    for (const [name, bytes] of files) if (name !== 'manifest.json') manifest.files.push({ name, size: bytes.length, sha256: await sha256(bytes) });
  }
  files.set('manifest.json', encode(manifest)); return packZip(files);
}
const edit = (files, name, mutate) => { const value = parseJson(files.get(name)); mutate(value); files.set(name, encode(value)); };

test('full local snapshot retains history, all card/group states, drafts, attachment bytes, lineage and layout without writing', async () => {
  const f = await fixture(); const before = f.disk(); const writes = f.writes();
  const { bytes, manifest } = await f.export(); const document = await openBackup(bytes);
  assert.ok(document instanceof BackupDocument); assert.deepEqual(document.manifest, manifest);
  assert.deepEqual(document.data.records, before.revisions); assert.deepEqual(document.data.drafts, Object.values(before.drafts));
  assert.deepEqual(document.data.layout, before.layout); assert.deepEqual(document.data.local.membershipRebases, before.membershipRebases);
  assert.deepEqual(document.data.local.cards, before.cards.map(({ id, revision }) => ({ id, revision })));
  assert.deepEqual(document.attachment(f.id), f.bytes); assert.equal(document.attachment('missing'), null);
  assert.equal(manifest.counts.cards, 2); assert.equal(manifest.counts.groups, 2); assert.equal(manifest.counts.drafts, 3);
  assert.equal(manifest.counts.attachments, 1); assert.equal(manifest.pendingOperations, before.outbox.length);
  assert.equal(manifest.scope, 'known-local-data'); assert.equal(manifest.lastSuccessfulSyncAt, null);
  assert.deepEqual(f.reads, [['private-profile-a', f.id]]); assert.deepEqual(f.disk(), before); assert.equal(f.writes(), writes);
  const data = document.data; data.records.length = 0; const metadata = document.manifest; metadata.counts.cards = 99;
  const attachment = document.attachment(f.id); attachment.fill(0);
  assert.deepEqual(document.data.records, before.revisions); assert.equal(document.manifest.counts.cards, 2);
  assert.deepEqual(document.attachment(f.id), f.bytes); assert.throws(() => new BackupDocument(), fails('invalid-backup-data'));
});

test('parallel branches, pending dependencies, transfer intent and unknown value extensions survive without inventing data', async () => {
  const f = await fixture(); const card = f.workspace.snapshot.cards.find(item => item.id === f.card.id);
  const session = await f.workspace.beginSync('private-source-id');
  const root = revisionRecord('card', { ...card, revision: 'parallel-root', content: { ...card.content, text: 'Another branch' }, future: { x: 1 } });
  const pending = revisionRecord('card', { ...card, id: 'pending-card', revision: 'pending-revision' }, ['not-received-parent']);
  await f.workspace.receiveRevisions([root, pending], { session, expectedCursor: null, cursor: 'private-cursor' });
  const state = f.workspace.state;
  state.conflicts.push({ kind: 'transfer', cardId: card.id, groupId: f.b.id, expectedRevision: 'earlier-unavailable' });
  state.sync.accessToken = 'private-token-marker'; state.sync.files = { 'private-drive-file': {} };
  const { bytes, manifest } = await f.export({ workspace: { state } }); const document = await openBackup(bytes);
  assert.deepEqual(document.data.records, state.revisions); assert.equal(manifest.counts.pendingRevisions, 1);
  assert.equal(manifest.counts.conflicts, state.conflicts.length); assert.equal(document.data.local.transferIntents.length, 1);
  const text = [...(await unpackZip(bytes)).values()].map(value => new TextDecoder().decode(value)).join('\n');
  for (const secret of ['private-profile-a', 'private-source-id', 'private-cursor', 'private-token-marker', 'private-drive-file', 'operationId']) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.ok(text.includes('not-received-parent')); assert.ok(text.includes('future'));
});

test('attachment lookup remains bound to the captured profile and concurrent edits are left for the next backup', async () => {
  const f = await fixture(); const before = f.workspace.state; let captured;
  const storage = { getAttachment: async (profile, id) => {
    captured = profile; await f.workspace.createCard({ format: 'markdown', text: 'after snapshot' }, f.b.id);
    return f.storage.getAttachment(profile, id);
  } };
  const result = await f.export({ storage }); const document = await openBackup(result.bytes);
  assert.equal(captured, before.profileId); assert.deepEqual(document.data.records, before.revisions);
  assert.equal(f.workspace.snapshot.cards.length, before.cards.length + 1);
});

test('draft lineage compares JSON values across key ordering while preserving separately edited ancestors', async () => {
  const f = await fixture(); const { bytes } = await f.export(); const document = await openBackup(bytes);
  for (const changed of [false, true]) {
    const state = f.workspace.state; state.drafts = Object.fromEntries(document.data.drafts.map(draft => [draft.id, draft]));
    const recovered = state.drafts['recovered-draft']; const origin = recovered.recoveredFrom[0];
    // Legacy local baselines used insertion-order JSON.stringify; imported JSON has canonical key order.
    const prior = parseJson(origin.baseline);
    origin.baseline = JSON.stringify(Object.fromEntries(Object.entries(prior).reverse()));
    if (changed) state.drafts[origin.id].content.text = 'independent later edit';
    let disk; const restored = new Workspace(state, async value => { disk = copy(value); });
    await restored.commitDraft(recovered.id);
    assert.equal(Object.hasOwn(disk.drafts, origin.id), changed);
    assert.equal(Object.hasOwn(disk.drafts, recovered.id), false);
    if (changed) assert.equal(disk.drafts[origin.id].content.text, 'independent later edit');
  }
});

test('missing, mismatched and corrupt historical attachments refuse a complete export without any data writes', async () => {
  for (const kind of ['missing', 'size', 'hash']) {
    const f = await fixture(); const before = f.disk(); const writes = f.writes();
    f.blobs.set(f.id, kind === 'missing' ? null : kind === 'size' ? new Blob(['wrong size']) : new Blob([new Uint8Array(f.bytes.length)]));
    await assert.rejects(f.export(), fails('incomplete-backup')); assert.deepEqual(f.disk(), before); assert.equal(f.writes(), writes);
  }
  const f = await fixture(); const state = f.workspace.state; state.conflicts.push({ kind: 'future-conflict', value: 'must retain' });
  await assert.rejects(f.export({ workspace: { state } }), fails('unsupported-backup-data'));
});

test('manifest version, closed envelope, file inventory, counts and digests are independently checked', async () => {
  const { bytes } = await (await fixture()).export();
  const mutations = [
    (files, manifest) => { manifest.schemaVersion = 2; },
    (files, manifest) => { manifest.sourceToken = 'not permitted'; },
    (files, manifest) => { manifest.counts.cards++; },
    (files, manifest) => { manifest.createdAt = '2026-02-30T00:00:00.000Z'; },
    (files, manifest) => { manifest.scope = 'all-cloud-data'; },
    files => files.delete('local.json'),
    files => { files.set('drafts/99999999.json', encode({})); },
  ];
  for (const mutate of mutations) await assert.rejects(openBackup(await change(bytes, mutate)));
  await assert.rejects(openBackup(await change(bytes, files => edit(files, 'layout.json', value => { value.desktopVisible = !value.desktopVisible; }),
    { rehash: false })), fails('invalid-backup-data'));
  await assert.rejects(openBackup(await change(bytes, (files, manifest) => { manifest.files.push(manifest.files[0]); },
    { rehash: false })), fails('invalid-backup-data'));
});

test('valid hashes cannot disguise duplicate revisions, bad selected heads, invalid layout or forged membership rebases', async () => {
  const { bytes } = await (await fixture()).export();
  for (const mutate of [
    files => { files.set('revisions/99999999.json', files.get('revisions/00000000.json')); },
    files => edit(files, 'local.json', value => { value.cards[0].revision = 'absent'; }),
    files => edit(files, 'local.json', value => { value.groups.pop(); }),
    files => edit(files, 'layout.json', value => { value.grid.slots = ['missing-group']; }),
    files => edit(files, 'layout.json', value => { value.mainView = 'grid'; }),
    files => edit(files, 'layout.json', value => { value.mainGroupId = 'missing-group'; }),
    files => edit(files, 'layout.json', value => { value.mainGroupId = null; }),
    files => edit(files, 'layout.json', value => { value.completedVisible = 'no'; }),
    files => edit(files, 'layout.json', value => { value.quickMove = 'yes'; }),
    files => edit(files, 'layout.json', value => { value.groupColors = { ...value.groupColors, 'missing-group': 0 }; }),
    files => edit(files, 'layout.json', value => { value.groupColors = Object.fromEntries(Object.keys(value.groupColors).map(id => [id, 9])); }),
    files => edit(files, 'layout.json', value => { value.groupOpacity = { 'missing-group': 0.5 }; }),
    files => edit(files, 'layout.json', value => { value.groupOpacity = Object.fromEntries(Object.keys(value.groupColors).map(id => [id, 0.1])); }),
    files => edit(files, 'layout.json', value => { value.placements['unknown-card'] = Object.values(value.placements)[0]; }),
    files => edit(files, 'local.json', value => { Object.values(value.membershipRebases)[0].revision = value.groups[0].revision; }),
    files => edit(files, 'drafts/00000000.json', value => { value.baseRevision = parseJson(files.get('local.json')).groups[0].revision; }),
    files => edit(files, 'drafts/00000001.json', value => { value.recoveredFrom[0].baseline = '{"id":"wrong-id"}'; }),
  ]) await assert.rejects(openBackup(await change(bytes, mutate)));
});

test('extra or renamed attachments, conflicting declared sizes and duplicate JSON keys fail even with fresh manifest hashes', async () => {
  const f = await fixture(); const { bytes } = await f.export();
  for (const mutate of [
    files => { files.set(`attachments/${'0'.repeat(64)}.bin`, f.bytes); },
    files => { files.delete(`attachments/${f.id}.bin`); },
    files => { files.set(`attachments/${f.id}.bin`, new Uint8Array(f.bytes.length)); },
    files => edit(files, 'drafts/00000000.json', value => { value.content.attachments[0].size++; }),
    files => { files.set('layout.json', new TextEncoder().encode('{"schemaVersion":1,"schemaVersion":1}')); },
  ]) await assert.rejects(openBackup(await change(bytes, mutate)));
});

test('encrypted payload retains the same logical fingerprint, authenticates all metadata and can be cancelled without writes', async () => {
  const f = await fixture(); const writes = f.writes(); const password = 'my long password 中文 🔐';
  const plain = await f.export(); const encrypted = await f.export({ password });
  const one = await openBackup(plain.bytes); const two = await openBackup(encrypted.bytes, { password });
  assert.equal(one.fingerprint, two.fingerprint); assert.deepEqual(one.data, two.data); assert.deepEqual(two.attachment(f.id), f.bytes);
  await assert.rejects(openBackup(encrypted.bytes, { password: 'different password' }), fails('backup-decryption'));
  const controller = new AbortController();
  await assert.rejects(f.export({ signal: controller.signal, progress: () => controller.abort() }), fails('backup-cancelled'));
  assert.equal(f.writes(), writes);
});

test('large history validation dispatches a queued cancel before validating the whole snapshot', async () => {
  const f = await fixture(); const state = f.workspace.state; const root = state.cards[0];
  const history = Array.from({ length: 8000 }, (_, index) => ({ format: 'work-fleet-revision', schemaVersion: 1, kind: 'card',
    entityId: root.id, revisionId: `history-${index}`, parents: [index ? `history-${index - 1}` : root.revision],
    value: { ...copy(root), revision: `history-${index}` } }));
  state.revisions.push(...history); state.cards[0] = history.at(-1).value;
  const controller = new AbortController(); let dispatched = false;
  const timer = setTimeout(() => { dispatched = true; controller.abort(); }, 0);
  try {
    await assert.rejects(f.export({ workspace: { state }, signal: controller.signal }), fails('backup-cancelled'));
    assert.equal(dispatched, true); assert.deepEqual(f.reads, []);
  } finally { clearTimeout(timer); }
});
