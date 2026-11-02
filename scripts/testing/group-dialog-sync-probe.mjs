/** Group dialogs while a sync holds the desktop action queue. Production UI, DesktopOwner and DatasetSync; synthetic host and Drive. */
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
import { DatasetTestProvider } from '../../tests/fixtures/dataset/provider.js';
import { Workspace } from '../../src/core/workspace.js';
import { WorkspaceRecordStorage } from '../../src/storage/workspace-records.js';
import { MemoryRecordStore } from '../../src/storage/records.js';
import { DatasetSync } from '../../src/sources/dataset-sync.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/group-dialog-sync-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit]\nHolds a synthetic Drive request so a sync keeps the desktop action queue, then checks that group dialogs open at once and one at a time without overtaking an earlier click, that saving or merging counts once, and what happens when the sync lands under the dialog. Uses isolated browser profiles and no account; it does not run a native host.');
  process.exit(0);
}
const value = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--url'), '--url is required');
const base = new URL(value('--url')), engine = process.argv.includes('--browser') ? value('--browser') : 'chromium';
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
assert.ok(['chromium', 'webkit'].includes(engine));
const profileId = 'google:test';

// `desktopPresentation` is what makes the renderer build the DesktopOwner whose queue a sync holds; every browser probe
// without it runs actions with no queue at all, so the held sync cannot be seen there.
const bridgeModule = `
export async function connectNative() {
  const events = new Map();
  window.fixtureHostEvent = type => { for (const callback of events.get(type) ?? []) callback({}); };
  return { info: { profileId: '${profileId}', platform: 'linux', appVersion: '0.4.0',
    capabilities: { recordStorage: true, googleFiles: true, desktopPresentation: true } },
    bridge: { onEvent(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback); return () => events.get(type).delete(callback);
      }, onCloseRequested() { return () => {}; },
      async request(method, params = {}) {
        if (method === 'google.status') return { connected: true, configured: true, accountId: 'test', email: 'probe@example.invalid' };
        if (method === 'desktop.info') return { sessionId: '00000000-0000-4000-8000-000000000001', topology: 0, views: [], layers: ['wallpaper', 'desktop', 'floating'], adjustOverlay: true,
          workAreas: [{ x: 0, y: 0, width: 1200, height: 900, primary: true }] };
        if (method === 'desktop.shortcuts.configure') return { registrations: [] };
        if (method === 'desktop.frame.begin') return { token: 'frame' };
        if (method === 'desktop.frame.append') return { offset: params.offset + atob(params.base64).length };
        return {};
      } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() { return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, async (...args) => {
    if (key === 'commit') { window.fixtureCommits = (window.fixtureCommits || 0) + 1; await window.fixtureCommitGate; }
    return store[key](...args);
  }])); }
}`;
const storageModule = `
export { NativeTransfers } from '/storage/native.js?original=1';
import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
const journal = await IndexedDbBackupJournal.open();
export class NativeStorage { journal() { return journal; } close() {} }`;
const googleModule = `
export class NativeGoogleDatasetStore {
  get sourceId() { return 'google-drive:test:appdata-v1'; }
  async allocateFileIds(count) {
    const result = await window.fixtureDrive('allocateFileIds', { count });
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return result.value;
  }
  constructor() {
    for (const method of ['allocateFileId', 'getStartCursor', 'getObject', 'readObject', 'createObject', 'createFolder',
      'readFile', 'createFile', 'deleteFile', 'deleteFiles', 'listObjects', 'listDatasetChanges']) this[method] = async (input = {}) => {
      const { signal, ...args } = input; signal?.throwIfAborted();
      if (args.bytes) args.bytes = Array.from(args.bytes);
      const result = await window.fixtureDrive(method, args); signal?.throwIfAborted();
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
      return ['readObject', 'readFile'].includes(method) ? Uint8Array.from(result.value) : result.value;
    };
  }
}`;

const browser = await ({ chromium, webkit })[engine].launch();
try {
  const provider = new DatasetTestProvider(), errors = [];
  const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), profileId);
  const seed = await Workspace.create({ profileId, deviceId: 'first-device', current: true, bootstrapGroup: false,
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
  const seedSync = new DatasetSync({ workspace: seed, storage, fileStore: provider }); await seedSync.sync();
  await seed.createCard({ format: 'markdown', text: 'Existing cloud note', attachments: [] }); await seedSync.sync(); await seedSync.stop();

  let hold = false, release = null, failHeld = null;
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
  await context.exposeFunction('fixtureDrive', async (method, args) => {
    try {
      if (method === 'listDatasetChanges' && hold) {
        hold = false; await new Promise(resolve => { release = resolve; });
        if (failHeld) { const code = failHeld; failHeld = null; throw Object.assign(new Error('Synthetic changed dataset'), { code }); }
      }
      if (args.bytes) args.bytes = Uint8Array.from(args.bytes);
      const result = method === 'allocateFileIds' ? await Promise.all(Array.from({ length: args.count }, () => provider.allocateFileId())) : await provider[method](args);
      return { ok: true, value: result instanceof Uint8Array ? Array.from(result) : result };
    } catch (error) { return { ok: false, code: error.code, message: error.message }; }
  });
  for (const [path, body] of [['native/bridge', bridgeModule], ['storage/records-native', recordsModule],
    ['storage/native', storageModule], ['native/google', googleModule]]) {
    await context.route(new RegExp(`/${path}\\.js$`), route => route.fulfill({ contentType: 'text/javascript', body }));
  }
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base.origin}/app/index.html?profile=${encodeURIComponent(profileId)}`);
  const synced = () => expect(page.locator('#google-sync')).toBeEnabled();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 15000 });
  await synced();

  const open = () => page.locator('dialog[open]').count();
  const groups = () => page.locator('#groups .group-row').count();
  // A sync that stays inside its first Drive request, as a slow connection does, with its action queue held.
  const holdSync = async () => {
    hold = true; await page.evaluate(() => window.fixtureHostEvent('host-foreground'));
    await expect.poll(() => typeof release).toBe('function');
  };
  const finishSync = async () => { release(); release = null; await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/); };
  const press = (selector, times = 1) => page.evaluate(([selector, times]) => {
    for (let index = 0; index < times; index++) document.querySelector(selector).click();
  }, [selector, times]);
  const dialogButton = name => page.locator('dialog[open]').getByRole('button', { name, exact: true });
  const submit = times => page.evaluate(times => { for (let index = 0; index < times; index++) document.querySelector('dialog[open] form').requestSubmit(); }, times);

  // Clicks during a sync open one dialog at once, and nothing further appears when the sync ends.
  const before = await groups();
  await holdSync(); await press('#add-group', 3);
  const openedDuring = await open();
  await finishSync(); const openedAfter = await open();
  assert.deepEqual({ openedDuring, openedAfter }, { openedDuring: 1, openedAfter: 1 }, 'three clicks during a sync must open one dialog at once and no more afterwards');
  await dialogButton(t('common.cancel')).click(); await expect(page.locator('dialog[open]')).toHaveCount(0);

  // Saving waits for its turn behind the sync, but several presses create one group.
  await holdSync(); await press('#add-group');
  await page.locator('dialog[open]').getByRole('textbox').fill('Created during sync');
  await submit(3); await expect(dialogButton(t('common.save'))).toBeDisabled();
  await finishSync();
  await expect(page.locator('dialog[open]')).toHaveCount(0); await expect(page.locator('#groups .group-row')).toHaveCount(before + 1);
  assert.equal(await page.locator('#groups .group-name', { hasText: 'Created during sync' }).count(), 1, 'three presses of Save must create one group');

  // Closing the dialog while its save still waits withdraws the save.
  await synced(); await holdSync(); await press('#add-group');
  await page.locator('dialog[open]').getByRole('textbox').fill('Withdrawn during sync');
  await submit(1); await dialogButton(t('common.cancel')).click(); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await finishSync();
  await expect(page.locator('#groups .group-row')).toHaveCount(before + 1);
  assert.equal(await page.locator('#groups .group-name', { hasText: 'Withdrawn during sync' }).count(), 0, 'a cancelled save must not create a group');

  // Group settings open the same way, and several presses of Merge open one merge dialog when the sync ends.
  await holdSync(); await press('#groups .group-row .group-menu', 3);
  assert.equal(await open(), 1, 'three clicks on group settings during a sync must open one dialog at once');
  await press('dialog[open] .dialog-actions button:first-child', 3);
  await finishSync();
  await expect(page.locator('#merge-dialog')).toHaveCount(1); assert.equal(await open(), 1, 'three presses of Merge must open one merge dialog');
  await dialogButton(t('common.cancel')).click(); await expect(page.locator('dialog[open]')).toHaveCount(0);

  // An earlier click keeps its place: adjusting starts, and the editor behind it does not open under the overlay.
  const adjusting = () => page.evaluate(() => document.documentElement.inert);
  await synced(); await holdSync(); await press('#operate-all'); await press('#add-group');
  assert.equal(await open(), 0, 'a click after Adjust must not open a dialog ahead of it');
  await finishSync(); await expect.poll(adjusting).toBe(true);
  assert.equal(await open(), 0, 'the editor queued behind Adjust must not open under the overlay');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect.poll(adjusting).toBe(false);

  // A sync renaming the group under the dialog refuses the rename once; trying again, as the refusal says, succeeds.
  await synced(); await page.evaluate(() => window.fixtureHostEvent('host-foreground'));
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok'); await synced();
  const peerStorage = new WorkspaceRecordStorage(new MemoryRecordStore(), profileId);
  const peer = await Workspace.create({ profileId, deviceId: 'peer-device', current: true, bootstrapGroup: false,
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => peerStorage.save(...args) });
  const peerSync = new DatasetSync({ workspace: peer, storage: peerStorage, fileStore: provider }); await peerSync.sync();
  const renamed = peer.snapshot.groups.find(group => group.name === 'Created during sync');
  await holdSync();
  await page.locator('#groups .group-row', { hasText: 'Created during sync' }).locator('.group-menu').evaluate(node => node.click());
  await page.locator('dialog[open]').getByRole('textbox').fill('Named here');
  await peer.renameGroup(renamed.id, 'Renamed elsewhere', renamed.revision); await peerSync.sync(); await peerSync.stop();
  await finishSync(); await expect(page.locator('#groups .group-name', { hasText: 'Renamed elsewhere' })).toHaveCount(1);
  await submit(1); await expect(page.locator('#status')).toHaveText(t('errors.core.groupUpdated'));
  await expect(dialogButton(t('common.save'))).toBeEnabled();
  await submit(1); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#groups .group-name', { hasText: 'Named here' })).toHaveCount(1);

  // Once a save is writing, Cancel and Escape leave the dialog until the outcome is known.
  await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/);
  await press('#add-group'); await page.locator('dialog[open]').getByRole('textbox').fill('Written despite Cancel');
  await page.evaluate(() => { window.fixtureCommits = 0; window.fixtureCommitGate = new Promise(resolve => { window.fixtureOpenCommits = resolve; }); });
  await submit(1); await expect.poll(() => page.evaluate(() => window.fixtureCommits)).toBeGreaterThan(0);
  await press('dialog[open] .dialog-actions button:not([type=submit])'); await page.keyboard.press('Escape');
  assert.equal(await open(), 1, 'Cancel and Escape must not close a dialog whose save is writing');
  await page.evaluate(() => { window.fixtureOpenCommits(); window.fixtureCommitGate = undefined; });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#status')).toHaveText(t('app.status.groupSaved'));
  await expect(page.locator('#groups .group-name', { hasText: 'Written despite Cancel' })).toHaveCount(1);

  // A failure needing a recovery question cannot ask over the dialog, so it asks when the dialog closes. Keep this last:
  // it leaves the session blocked on that question.
  await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok');
  failHeld = 'dataset-changed'; await holdSync(); await press('#add-group'); release(); release = null;
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'attention');
  assert.equal(await open(), 1, 'the recovery question must not open over the group dialog');
  await dialogButton(t('common.cancel')).click();
  await expect(page.locator('#source-reset-dialog')).toHaveCount(1);

  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: group dialogs open at once during a held sync, keep click order, count one press and survive a sync landing beneath them.`);
  await context.close();
} finally { await browser.close(); }
