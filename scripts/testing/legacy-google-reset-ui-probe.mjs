/** Full app recovery navigation with synthetic Google data. No credentials or installed app data are used. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { DatasetTestProvider } from '../../tests/fixtures/dataset/provider.js';
import { Workspace } from '../../src/core/workspace.js';
import { WorkspaceRecordStorage } from '../../src/storage/workspace-records.js';
import { MemoryRecordStore } from '../../src/storage/records.js';
import { DatasetSync } from '../../src/sources/dataset-sync.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/legacy-google-reset-ui-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--platform linux|ios|android]\nRuns the production app with real IndexedDB and synthetic native/account/Drive adapters in isolated browser profiles. Phone modes also check the handheld UI at 390 x 844; they do not run a native host.');
  process.exit(0);
}
const value = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--url'), '--url is required');
const base = new URL(value('--url')), engine = process.argv.includes('--browser') ? value('--browser') : 'chromium';
const platform = process.argv.includes('--platform') ? value('--platform') : 'linux', handheld = platform !== 'linux';
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname)); assert.ok(['chromium', 'webkit'].includes(engine));
assert.ok(['linux', 'ios', 'android'].includes(platform));
const browser = await ({ chromium, webkit })[engine].launch();
const profileId = 'google:test', email = 'old-notes@example.invalid';

// Replace only host/provider boundaries. The UI, WorkspaceRecordStorage, DatasetSync and DatasetReset are real.
const bridgeModule = `
export async function connectNative() {
  window.fixtureCloseHandlers = []; window.fixtureCloseReady = 0; window.fixtureCloseCancelled = [];
  const events = new Map();
  window.fixtureHostEvent = type => { for (const callback of events.get(type) ?? []) callback({}); };
  return { info: { profileId: 'google:test', platform: '${platform}', appVersion: '0.4.0',
    capabilities: { recordStorage: true, googleFiles: true, dataRecovery: ${!handheld} } },
    bridge: { onEvent(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback); return () => events.get(type).delete(callback);
      }, onCloseRequested(callback) { window.fixtureCloseHandlers.push(callback); return () => {}; },
      async request(method, params = {}) {
        if (method === 'google.status') return { connected: true, configured: true, accountId: 'test', email: '${email}' };
        if (method === 'google.profile' || method === 'host.ready') return {};
        if (method === 'host.closeReady') { window.fixtureCloseReady++; return {}; }
        if (method === 'host.closeCancel') { window.fixtureCloseCancelled.push(params.message); return {}; }
        if (method === 'backup.manual.choose') return new Promise((resolve, reject) => {
          window.fixtureCancelPicker = () => reject(Object.assign(new Error('Synthetic picker cancelled'), { code: 'backup-cancelled' }));
        });
        if (method === 'data.reveal') return {};
        if (method === 'data.location') return { path: '/synthetic-data' };
        throw new Error('Unexpected synthetic host call: ' + method);
      } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() {
    // Native reset is owned by storage.reset, not by the record adapter.
    return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, async (...args) => {
      if (key === window.fixtureReadFailure) throw Object.assign(new Error('Synthetic unreadable database'), { code: 'data-unreadable' });
      if (key === 'commit') {
        window.fixtureCommits = (window.fixtureCommits || 0) + 1;
        await window.fixtureCommitGate;
        if (window.fixtureWriteFailure) throw new Error('Synthetic disk full');
      }
      return store[key](...args);
    }]));
  }
}`;
const storageModule = `
export { NativeTransfers } from '/storage/native.js?original=1';
import { IndexedDbStorage } from '/storage/indexed-db.js';
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
const legacy = await IndexedDbStorage.open(), records = await IndexedDbRecordStore.open(), journal = await IndexedDbBackupJournal.open();
export class NativeStorage {
  journal() { return journal; }
  close() { legacy.close(); records.close(); }
  async reset(profile) {
    await window.fixtureLocalReset(profile);
    await legacy.reset(profile); await records.reset(profile); await journal.reset(profile);
    location.reload();
  }
}`;
const googleModule = `
export class NativeGoogleDatasetStore {
  get sourceId() { return 'google-drive:test:appdata-v1'; }
  constructor() {
    for (const method of ['allocateFileId', 'getStartCursor', 'getObject', 'readObject', 'createObject', 'createFolder',
      'readFile', 'createFile', 'deleteFile', 'listObjects', 'listDatasetChanges']) this[method] = async (input = {}) => {
      const { signal, ...args } = input; signal?.throwIfAborted();
      if (args.bytes) args.bytes = Array.from(args.bytes);
      const result = await window.fixtureDrive(method, args); signal?.throwIfAborted();
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
      return ['readObject', 'readFile'].includes(method) ? Uint8Array.from(result.value) : result.value;
    };
  }
}`;

try {
  for (const [oldLocal, oldCloud] of [[false, true], [true, true], [true, false]]) {
    const context = await browser.newContext({ viewport: handheld ? { width: 390, height: 844 } : { width: 1200, height: 900 },
      locale: 'en-US', hasTouch: handheld, isMobile: handheld });
    if (oldLocal) await context.addInitScript(() => {
      // Linux's native WebView disables browser storage. Recovery navigation must not depend on it.
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
        get() { throw new DOMException('Synthetic browser storage unavailable', 'SecurityError'); },
      });
    });
    const provider = new DatasetTestProvider(), localResets = [], errors = [], oldReads = [];
    let failLocalReset = oldLocal, releaseFailedReset = null;
    const resetInterruption = oldCloud && !oldLocal;
    let releaseReset = null, interruptReset = resetInterruption;
    const oldIds = oldCloud ? ['old-note-1', 'old-note-2', 'old-layout',
      ...resetInterruption ? Array.from({ length: 103 }, (_, i) => `old-history-${i}`) : []] : [];
    for (const id of oldIds) provider.files.set(id, { file: { id, kind: 'revision' }, bytes: new Uint8Array([255, 0, 128]) });
    if (!oldCloud) {
      const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), profileId);
      const workspace = await Workspace.create({ profileId, deviceId: 'first-device', current: true, bootstrapGroup: false,
        area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
      const sync = new DatasetSync({ workspace, storage, fileStore: provider }); await sync.sync();
      await workspace.createCard({ format: 'markdown', text: 'Existing new cloud note', attachments: [] }); await sync.sync();
      await sync.stop();
    }
    const originalFiles = [...provider.files.keys()], originalCreates = provider.stats.creates;
    provider.hook = async (method, id) => {
      if (method === 'read' && oldIds.includes(id)) { oldReads.push(id); throw new Error('Legacy contents must not be read'); }
      if (interruptReset && method === 'create-before' && [...provider.files.values()].some(item => item.file.kind === 'reset')) {
        interruptReset = false;
        await new Promise(resolve => { releaseReset = resolve; });
        throw Object.assign(new Error('Synthetic reset rate limit'), { code: 'rate-limit' });
      }
    };
    await context.exposeFunction('fixtureLocalReset', async profile => {
      assert.equal(profile, profileId);
      if (failLocalReset) {
        failLocalReset = false; await new Promise(resolve => { releaseFailedReset = resolve; });
        throw new Error('Synthetic local reset unavailable');
      }
      localResets.push(profile);
    });
    await context.exposeFunction('fixtureDrive', async (method, args) => {
      try {
        if (args.bytes) args.bytes = Uint8Array.from(args.bytes);
        const result = await provider[method](args);
        return { ok: true, value: result instanceof Uint8Array ? Array.from(result) : result };
      } catch (error) { return { ok: false, code: error.code, message: error.message }; }
    });
    for (const [path, body] of [['native/bridge', bridgeModule], ['storage/records-native', recordsModule],
      ['storage/native', storageModule], ['native/google', googleModule]]) {
      await context.route(new RegExp(`/${path}\\.js$`), route => route.fulfill({ contentType: 'text/javascript', body }));
    }
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    const unchangedCloud = () => {
      assert.deepEqual([...provider.files.keys()], originalFiles); assert.equal(provider.stats.creates, originalCreates);
      assert.equal(provider.stats.deletes, 0); assert.deepEqual(oldReads, []);
    };
    const requestClose = () => page.evaluate(() => window.fixtureCloseHandlers[0]());
    const terminalClose = async () => {
      await expect.poll(() => page.evaluate(() => window.fixtureCloseReady)).toBe(1);
      assert.deepEqual(await page.evaluate(() => window.fixtureCloseCancelled), []);
      assert.equal(await page.evaluate(() => document.body.inert), true);
      const stats = { ...provider.stats }, commits = await page.evaluate(() => window.fixtureCommits);
      await requestClose();
      await page.evaluate(() => { window.fixtureHostEvent('host-tick'); window.fixtureHostEvent('host-foreground'); dispatchEvent(new Event('online')); });
      await page.clock.fastForward(65000);
      assert.equal(await page.evaluate(() => window.fixtureCloseReady), 1, 'duplicate close requests coalesce');
      assert.equal(await page.evaluate(() => window.fixtureCommits), commits, 'no writes resume after close acknowledgement');
      assert.deepEqual(provider.stats, stats, 'no Drive work resumes after close acknowledgement');
    };
    const read = () => page.evaluate(async profile => {
      const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
      const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
      const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
      try {
        for (let attempt = 0; attempt < 20; attempt++) {
          try { return { state: await storage.load(profile), reset: await storage.getJob('dataset-reset') }; }
          catch (error) { if (error.code !== 'stale-writer' || attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
        }
      }
      finally { storage.close(); }
    }, profileId);
    const legacy = () => page.evaluate(async profile => {
      const { IndexedDbStorage } = await import('/storage/indexed-db.js');
      const storage = await IndexedDbStorage.open();
      try { return { google: await storage.load(profile), local: await storage.load('local-sentinel') }; }
      finally { storage.close(); }
    }, profileId);
    try {
      await page.goto(new URL('/app/style.css', base).href);
      await page.evaluate(async ({ profile, oldLocal }) => {
        const { IndexedDbStorage } = await import('/storage/indexed-db.js');
        const { Workspace } = await import('/core/workspace.js');
        const storage = await IndexedDbStorage.open();
        for (const id of oldLocal ? ['local-sentinel', profile] : ['local-sentinel']) {
          const workspace = await Workspace.create({ profileId: id, deviceId: 'old-device',
            area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
          await workspace.createCard({ format: 'markdown', text: 'Keep old local data until consent', attachments: [] });
        }
        storage.close();
      }, { profile: profileId, oldLocal });
      const before = await legacy();
      await page.goto(new URL('/app/index.html', base).href);
      if (oldLocal) {
        await expect(page.locator('#data-failure-dialog')).toBeVisible();
        assert.equal(await page.evaluate(() => window.fixtureCloseHandlers.length), 1);
        await page.evaluate(() => window.fixtureCloseHandlers[0]());
        await expect.poll(() => page.evaluate(() => window.fixtureCloseReady)).toBe(1);
        assert.deepEqual(await legacy(), before); unchangedCloud();
        // A real close tears down this renderer. Start a new one before testing recovery choices.
        await page.reload(); await expect(page.locator('#data-failure-dialog')).toBeVisible();
        await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
        await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
        await expect(page.locator('#settings-dialog')).toContainText(t('app.incompatible.googleReset'));
        await expect(page.locator('#settings-account-name')).toHaveText(email);
        await expect(page.locator('#discard-old-local')).toBeDisabled();
        if (handheld) {
          await expect(page.locator('#settings-dialog [data-page="desktop"]')).toBeHidden();
          await expect(page.locator('#settings-dialog [data-page="shortcuts"]')).toBeHidden();
          await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1, user-scalable=no/);
          await mkdir('build/mobile-reset', { recursive: true });
          await page.screenshot({ path: `build/mobile-reset/${platform}-${engine}.png`, fullPage: true, animations: 'disabled' });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'recovery Settings overflows the phone viewport');
          assert.ok(await page.locator('#close-settings').evaluate(control => {
            const bounds = control.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth;
          }), 'the recovery Settings close button is outside the phone viewport');
        }
        await page.locator('#close-settings').click();
        await expect(page.locator('#data-failure-dialog')).toBeVisible();
        assert.deepEqual(await legacy(), before); unchangedCloud(); assert.deepEqual(localResets, []);
        await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
        await page.locator('#discard-old-local-agree').check(); await page.locator('#discard-old-local').click();
        await expect.poll(() => Boolean(releaseFailedReset)).toBe(true);
        await page.evaluate(() => window.fixtureCloseHandlers[0]());
        assert.equal(await page.evaluate(() => window.fixtureCloseReady), 0, 'close waits for an in-flight local discard');
        releaseFailedReset();
        await expect(page.locator('#data-host [role="status"]')).toContainText('Synthetic local reset unavailable');
        await expect.poll(() => page.evaluate(() => window.fixtureCloseReady)).toBe(1);
        await expect(page.locator('#discard-old-local')).toBeEnabled();
        assert.deepEqual(await legacy(), before); unchangedCloud(); assert.deepEqual(localResets, []);
        await page.reload(); await expect(page.locator('#data-failure-dialog')).toBeVisible();
        await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
        await page.locator('#discard-old-local-agree').check();
        await page.locator('#discard-old-local').click();
        if (oldCloud) await expect(page.locator('#source-reset-dialog')).toBeVisible({ timeout: 15000 });
        else await expect.poll(async () => (await read()).state?.cards[0]?.content.text, { timeout: 15000 }).toBe('Existing new cloud note');
        assert.deepEqual(localResets, [profileId]);
        assert.equal((await legacy()).google, null);
      } else {
        await expect(page.locator('#source-reset-dialog')).toBeVisible();
      }
      if (!oldCloud) {
        await expect(page.locator('#source-reset-dialog')).toBeHidden(); unchangedCloud();
        assert.deepEqual((await legacy()).local, before.local); assert.deepEqual(errors, []);
        console.log(`PASS ${engine}/${platform}: legacy local second device joins current cloud without cloud reset.`);
        continue;
      }
      const assertRecoveryPaused = async () => {
        await expect(page.locator('#source-reset-dialog')).toHaveCount(0);
        const pausedStats = { ...provider.stats };
        // A user can read Settings for more than one sync interval or leave and return to the app.
        // Neither may retry the incompatible dataset or put its prompt above the reset controls.
        await page.clock.fastForward(41000);
        await expect(page.locator('#settings-account-status')).toHaveText(t('sync.recovery.paused'));
        await expect(page.locator('#source-reset-dialog')).toHaveCount(0);
        await page.evaluate(() => {
          window.fixtureHostEvent('host-foreground');
          document.dispatchEvent(new Event('visibilitychange'));
          dispatchEvent(new Event('online'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          try { window.fixtureHostEvent('host-tick'); } finally { delete document.visibilityState; }
        });
        await page.clock.fastForward(21000);
        await expect(page.locator('#settings-account-status')).toHaveText(t('sync.recovery.paused'));
        await expect(page.locator('#source-reset-dialog')).toHaveCount(0);
        assert.deepEqual(provider.stats, pausedStats, 'paused recovery must not make background Drive calls');
      };
      // Dismissing a notice must keep syncing paused, while the explicit recovery entry stays usable.
      await page.locator('#source-reset-dialog').getByRole('button', { name: t('common.later'), exact: true }).click();
      await assertRecoveryPaused();
      if (handheld) await page.locator('#drawer-toggle').click();
      await page.locator('#settings-button').click();
      await page.locator('#settings-dialog [data-page="account"]').click();
      await page.locator('#google-sync').click();
      await expect(page.locator('#source-reset-dialog')).toBeVisible();
      if (!handheld) {
        // The reported update failure: Settings and a cloud recovery notice are both open, with no operation running.
        await requestClose(); await terminalClose(); unchangedCloud();
        await page.reload(); await expect(page.locator('#source-reset-dialog')).toBeVisible();
        console.log(`PASS ${engine}/${platform}: Settings plus recovery notice permits terminal native close without cloud changes.`);
      }
      await page.getByRole('button', { name: t('sync.recovery.reset'), exact: true }).click();
      await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
      await expect(page.locator('#settings-account-name')).toHaveText(email);
      await assertRecoveryPaused();
      unchangedCloud(); assert.deepEqual((await legacy()).local, before.local);
      if (!handheld) {
        await page.locator('#backup-encrypt').uncheck(); await page.locator('#export-backup').click();
        await expect.poll(() => page.evaluate(() => typeof window.fixtureCancelPicker)).toBe('function');
        await requestClose();
        await expect(page.locator('#close-error-dialog')).toContainText(t('app.close.finishOperation'));
        assert.equal(await page.evaluate(() => window.fixtureCloseReady), 0);
        assert.equal(await page.evaluate(() => document.body.inert), false);
        await page.evaluate(() => { window.fixtureCancelPicker(); window.fixtureCloseCancelled = []; });
        await page.locator('#close-error-dialog button').click();
        await expect(page.locator('#export-backup')).toBeEnabled(); unchangedCloud();
      }
      await page.locator('#reset-data').click();
      await expect(page.locator('#reset-data-dialog')).toContainText(email);
      await expect(page.locator('#reset-data-dialog')).toContainText(t('backup.reset.updateDevices'));
      await expect(page.locator('#confirm-reset-data')).toBeDisabled();
      if (!handheld) {
        await requestClose(); await terminalClose(); unchangedCloud();
        await page.reload(); await expect(page.locator('#source-reset-dialog')).toBeVisible();
        await page.getByRole('button', { name: t('sync.recovery.reset'), exact: true }).click();
        await page.locator('#reset-data').click();
        console.log(`PASS ${engine}/${platform}: unconfirmed reset permits native close without implying consent.`);
      }
      await page.locator('#reset-data-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
      unchangedCloud();
      // The other navigation action shares the same paused recovery state.
      if (handheld) await page.locator('#settings-back').click();
      await page.locator('#settings-dialog [data-page="account"]').click();
      await page.locator('#google-sync').click();
      await page.locator('#source-reset-dialog').getByRole('button', { name: t('sync.sourceReset.exportFirst'), exact: true }).click();
      await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
      await assertRecoveryPaused(); unchangedCloud();
      await page.locator('#reset-data').click(); await page.locator('#reset-agree').check();
      await page.locator('#confirm-reset-data').click();
      await expect(page.locator('#reset-data-dialog')).toHaveCount(0, { timeout: 15000 });
      if (resetInterruption) {
        await expect.poll(() => Boolean(releaseReset), { timeout: 15000 }).toBe(true);
        const operation = (await read()).reset.operationId;
        if (handheld) await page.locator('#drawer-toggle').click();
        await page.locator('#settings-button').click();
        await page.locator('#settings-dialog [data-page="account"]').click();
        await expect(page.locator('#account-detail')).toContainText('Creating the new cloud data:');
        await expect(page.locator('#account-detail')).not.toContainText('/ 106');
        await expect(page.locator('#google-sync')).toBeDisabled();
        releaseReset();
        await expect(page.locator('#account-detail')).toContainText('Synthetic reset rate limit');
        await expect(page.locator('#google-sync')).toBeEnabled();
        await page.reload();
        if (handheld) await page.locator('#drawer-toggle').click();
        await page.locator('#settings-button').click();
        await page.locator('#settings-dialog [data-page="account"]').click();
        await expect(page.locator('#account-detail')).toContainText('Synthetic reset rate limit');
        if (handheld) await page.locator('#settings-back').click();
        await page.locator('#settings-dialog [data-page="data"]').click();
        await expect(page.locator('#dataset-maintenance-status')).toContainText('Synthetic reset rate limit');
        await expect(page.locator('#retry-dataset-maintenance')).toBeEnabled();
        await mkdir('build/reset-settings', { recursive: true });
        await page.screenshot({ path: `build/reset-settings/${platform}-${engine}-error.png`, animations: 'disabled' });
        if (handheld) await page.locator('#settings-back').click();
        await page.locator('#settings-dialog [data-page="account"]').click();
        await page.locator('#google-sync').click();
        // Settings itself must not prevent a confirmed reset from continuing. No second reset confirmation or
        // renderer reload is needed, and the original operation/fence remains the only deletion authority.
        await expect(page.locator('#settings-dialog')).toBeVisible();
        await expect.poll(async () => (await read()).reset?.phase, { timeout: 30000 }).toBe('complete');
        assert.equal((await read()).reset.operationId, operation);
        await page.locator('#close-settings').click();
        console.log(`PASS ${engine}/${platform}: interrupted 106-file reset keeps its error across reload and resumes inside Settings.`);
      }
      await expect.poll(async () => (await read()).reset?.phase, { timeout: 30000 }).toBe('complete');
      const after = await read();
      assert.equal(after.state.format, 'work-fleet-workspace-current'); assert.equal(after.state.cards.length, 0);
      assert.ok(oldIds.every(id => !provider.files.has(id))); assert.deepEqual(oldReads, []);
      assert.deepEqual((await legacy()).local, before.local);
      assert.equal(localResets.length, oldLocal ? 1 : 0);
      await expect(page.locator('#account-name')).toHaveText(email);
      await page.locator('[data-view="board"]').click(); await page.locator('#compose').click();
      await page.locator('#editor-text').fill('First new note after reset');
      await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click();
      if (handheld) await page.locator('#drawer-toggle').click();
      await page.locator('#settings-button').click(); await page.locator('#settings-dialog [data-page="account"]').click();
      await page.locator('#google-sync').click();
      await expect.poll(() => [...provider.files.values()].some(item => item.file.kind === 'revision'
        && new TextDecoder().decode(item.bytes).includes('First new note after reset')), { timeout: 15000 }).toBe(true);
      if (!handheld) {
        await expect(page.locator('#google-sync')).toBeEnabled();
        const previousHook = provider.hook; let releaseSync = null;
        provider.hook = async (method, id) => {
          await previousHook(method, id);
          if (method === 'changes') await new Promise(resolve => { releaseSync = resolve; });
        };
        await page.locator('#google-sync').click();
        await expect.poll(() => Boolean(releaseSync)).toBe(true);
        await requestClose(); await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true);
        assert.equal(await page.evaluate(() => window.fixtureCloseReady), 0, 'in-flight sync must settle before native close');
        provider.hook = previousHook; releaseSync();
        await terminalClose();
        await page.reload(); await expect(page.locator('#groups .group-row').first()).toBeVisible();
        await page.locator('[data-view="board"]').click();
        await page.locator('#settings-button').click();
        await page.locator('#close-settings').click(); await page.locator('#compose').click();
        // An admitted local write must finish before acknowledgement; new input is no longer admitted.
        await page.evaluate(() => { window.fixtureCommitGate = new Promise(resolve => { window.fixtureReleaseCommit = resolve; }); });
        const commits = await page.evaluate(() => window.fixtureCommits);
        await page.locator('#editor-text').fill('Draft kept through graceful quit');
        await expect.poll(() => page.evaluate(() => window.fixtureCommits)).toBeGreaterThan(commits);
        await requestClose();
        await expect.poll(() => page.evaluate(() => document.body.inert)).toBe(true);
        assert.equal(await page.evaluate(() => window.fixtureCloseReady), 0);
        await page.evaluate(() => {
          document.querySelector('#editor-text').dispatchEvent(new Event('input', { bubbles: true }));
          window.fixtureReleaseCommit(); window.fixtureCommitGate = null;
        });
        await terminalClose();
        assert.ok(Object.values((await read()).state.drafts).some(draft => draft.content.text === 'Draft kept through graceful quit'));
        await page.reload(); await expect(page.locator('#groups .group-row').first()).toBeVisible();
        await page.locator('[data-view="board"]').click(); await page.locator('#compose').click();
        await page.evaluate(() => { window.fixtureWriteFailure = true; });
        await page.locator('#editor-text').fill('Keep this text when saving fails');
        await expect(page.locator('#draft-status')).toContainText('Synthetic disk full');
        await requestClose();
        await expect(page.locator('#close-error-dialog')).toContainText('Synthetic disk full');
        assert.equal(await page.evaluate(() => window.fixtureCloseReady), 0);
        assert.equal(await page.evaluate(() => document.body.inert), false);
        assert.ok(await page.evaluate(() => window.fixtureCloseCancelled[0].includes('Synthetic disk full')));
        await page.locator('#close-error-dialog button').click();
        await expect(page.locator('#editor-text')).toHaveValue('Keep this text when saving fails');
        await page.evaluate(() => { window.fixtureWriteFailure = false; window.fixtureCloseCancelled = []; });
        await requestClose(); await terminalClose();
        assert.ok(Object.values((await read()).state.drafts).some(draft => draft.content.text === 'Keep this text when saving fails'));
        console.log(`PASS ${engine}/${platform}: close stops sync and drains draft writes; a write failure visibly cancels, preserves text and permits retry.`);
      }
      assert.deepEqual(errors, []); assert.deepEqual(oldReads, []);
      console.log(`PASS ${engine}/${platform}: ${oldLocal ? 'legacy' : 'empty'} local profile + signed-in legacy Google, Settings consent/cancel, metadata-only reset, zero notes and new note sync.`);
    } finally { await context.close(); }
  }
  if (!handheld) for (const failure of ['status', 'get', 'page']) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(method => { window.fixtureReadFailure = method; }, failure);
    for (const [path, body] of [['native/bridge', bridgeModule], ['storage/records-native', recordsModule], ['storage/native', storageModule]])
      await context.route(new RegExp(`/${path}\\.js$`), route => route.fulfill({ contentType: 'text/javascript', body }));
    const page = await context.newPage();
    try {
      // Page failures need an active current generation so startup actually requests a page.
      await page.goto(new URL('/app/style.css', base).href);
      await page.evaluate(async profileId => {
        const { Workspace } = await import('/core/workspace.js');
        const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
        const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
        const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profileId);
        await Workspace.create({ profileId, current: true, deviceId: 'read-failure', area: { x: 0, y: 0, width: 1000, height: 800 }, persist: (...args) => storage.save(...args) });
        storage.close();
      }, profileId);
      await page.goto(new URL('/app/index.html', base).href);
      await expect(page.locator('#data-failure-dialog')).toBeVisible();
      await expect(page.locator('#data-failure-body')).toContainText(t('app.dataFailure.unreadable'));
      await expect(page.getByRole('button', { name: t('app.dataFailure.openFolder'), exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => window.fixtureCloseHandlers.length), 1);
      await page.evaluate(() => window.fixtureCloseHandlers[0]());
      await expect.poll(() => page.evaluate(() => window.fixtureCloseReady)).toBe(1);
      console.log(`PASS ${engine}/${platform}: ${failure} read failure shows recovery and acknowledges native close.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
