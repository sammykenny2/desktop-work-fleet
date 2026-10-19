import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { activeGroups, FleetError } from '../src/core/contracts.js';
import { Workspace } from '../src/core/workspace.js';
import { FileSync } from '../src/sources/file-sync.js';
import { INITIAL_GROUP_NAME } from '../src/sources/initial-group.js';
import { t } from '../src/i18n/index.js';
import { MemoryAttachmentStorage, MemoryFileStore } from './fixtures/file-store.js';

// Exercise the real editor/share-inbox guard without opening a native account or user's workspace.
const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const guard = source.slice(source.indexOf('async function ensureCaptureGroup()'), source.indexOf('async function openEditor('));

function fixture(profileId, groups = []) {
  const calls = [];
  const context = vm.createContext({ profileId, activeGroups, FleetError, t, activeGroupId: null,
    workspace: { snapshot: { groups }, createGroup: async name => {
      calls.push(name); const group = { id: 'new-local-group', name, deleted: false }; groups.push(group); return group;
    } }, render: () => calls.push('render') });
  vm.runInContext(guard, context);
  return { context, calls, invoke: () => vm.runInContext('ensureCaptureGroup()', context) };
}

test('a new or cleared Google copy cannot create a random initial group from the editor or share inbox before sync', async () => {
  const f = fixture('google:account');
  await assert.rejects(f.invoke(), error => error.code === 'initial-sync-required');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.context.workspace.snapshot.groups, []);
});

test('Google notes with an existing group remain available offline and local capture can still create its first group', async () => {
  const google = fixture('google:account', [{ id: 'existing', name: INITIAL_GROUP_NAME, deleted: false }]);
  await google.invoke(); assert.deepEqual(google.calls, []); assert.equal(google.context.activeGroupId, 'existing');
  const local = fixture('local'); await local.invoke(); await local.invoke();
  assert.deepEqual(local.calls, [t('app.groups.defaultName'), 'render']); assert.equal(local.context.activeGroupId, 'new-local-group');
});

test('the starter group a computer makes for an empty account starts on its back layer', async () => {
  let disk;
  const workspace = await Workspace.create({ profileId: 'google:account', deviceId: 'device', bootstrapGroup: false,
    area: { x: 0, y: 0, width: 1400, height: 900 }, arrivalLayer: () => 'wallpaper', persist: async state => { disk = structuredClone(state); } });
  const sync = new FileSync({ workspace, storage: new MemoryAttachmentStorage(), fileStore: new MemoryFileStore(), bootstrapGroup: true });
  await sync.sync();
  const [starter] = activeGroups(workspace.snapshot);
  assert.equal(starter.name, INITIAL_GROUP_NAME);
  assert.deepEqual(workspace.layout.state.groupLayers, { [starter.id]: 'wallpaper' });
  assert.deepEqual(disk.layout, workspace.layout.state);
});

test('a persisted initial group stays usable offline when its first upload fails before the active selection updates', async () => {
  const workspace = await Workspace.create({ profileId: 'google:account', deviceId: 'device', bootstrapGroup: false,
    area: { x: 0, y: 0, width: 1400, height: 900 }, persist: async () => {} });
  const store = new MemoryFileStore();
  store.hooks.createFile = ({ file }) => { if (file.kind === 'revision') throw new FleetError('network', 'offline'); };
  const sync = new FileSync({ workspace, storage: new MemoryAttachmentStorage(), fileStore: store, bootstrapGroup: true });
  await assert.rejects(sync.sync(), error => error.code === 'network');
  const f = fixture('google:account'); f.context.workspace = workspace;
  await f.invoke();
  const draft = workspace.blankDraft(f.context.activeGroupId); draft.content.text = 'Offline idea';
  await workspace.saveDraft(draft); await workspace.commitDraft(draft.id);
  assert.equal(workspace.snapshot.cards[0].content.text, 'Offline idea'); assert.deepEqual(f.calls, []);
});
