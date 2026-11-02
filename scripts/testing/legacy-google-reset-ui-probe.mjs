/** Full app recovery navigation with synthetic Google data. No credentials or installed app data are used. */
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
import { DatasetTestProvider } from '../../tests/fixtures/dataset/provider.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/legacy-google-reset-ui-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit]\nRuns the production app with real IndexedDB and synthetic native/account/Drive adapters in isolated browser profiles.');
  process.exit(0);
}
const value = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--url'), '--url is required');
const base = new URL(value('--url')), engine = process.argv.includes('--browser') ? value('--browser') : 'chromium';
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname)); assert.ok(['chromium', 'webkit'].includes(engine));
const browser = await ({ chromium, webkit })[engine].launch();
const profileId = 'google:test', email = 'old-notes@example.invalid';

// Replace only host/provider boundaries. The UI, WorkspaceRecordStorage, DatasetSync and DatasetReset are real.
const bridgeModule = `
export async function connectNative() {
  return { info: { profileId: 'google:test', platform: 'linux', appVersion: '0.4.0',
    capabilities: { recordStorage: true, googleFiles: true } },
    bridge: { onEvent() { return () => {}; }, onCloseRequested() { return () => {}; },
      async request(method) {
        if (method === 'google.status') return { connected: true, configured: true, accountId: 'test', email: '${email}' };
        if (method === 'google.profile' || method === 'host.ready') return {};
        throw new Error('Unexpected synthetic host call: ' + method);
      } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() {
    // Native reset is owned by storage.reset, not by the record adapter.
    return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, store[key].bind(store)]));
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
  for (const oldLocal of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
    if (oldLocal) await context.addInitScript(() => {
      // Linux's native WebView disables browser storage. Recovery navigation must not depend on it.
      for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
        get() { throw new DOMException('Synthetic browser storage unavailable', 'SecurityError'); },
      });
    });
    const provider = new DatasetTestProvider(), localResets = [], errors = [], oldReads = [];
    let failLocalReset = oldLocal;
    const oldIds = ['old-note-1', 'old-note-2', 'old-layout'];
    for (const id of oldIds) provider.files.set(id, { file: { id, kind: 'revision' }, bytes: new Uint8Array([255, 0, 128]) });
    provider.hook = async (method, id) => {
      if (method === 'read' && oldIds.includes(id)) { oldReads.push(id); throw new Error('Legacy contents must not be read'); }
    };
    await context.exposeFunction('fixtureLocalReset', profile => {
      assert.equal(profile, profileId);
      if (failLocalReset) { failLocalReset = false; throw new Error('Synthetic local reset unavailable'); }
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
    const unchangedCloud = () => {
      assert.deepEqual([...provider.files.keys()], oldIds); assert.equal(provider.stats.creates, 0);
      assert.equal(provider.stats.deletes, 0); assert.deepEqual(oldReads, []);
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
        await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
        await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
        await expect(page.locator('#settings-dialog')).toContainText(t('app.incompatible.googleReset'));
        await expect(page.locator('#settings-account-name')).toHaveText(email);
        await expect(page.locator('#discard-old-local')).toBeDisabled();
        await page.locator('#close-settings').click();
        await expect(page.locator('#data-failure-dialog')).toBeVisible();
        assert.deepEqual(await legacy(), before); unchangedCloud(); assert.deepEqual(localResets, []);
        await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
        await page.locator('#discard-old-local-agree').check(); await page.locator('#discard-old-local').click();
        await expect(page.locator('#data-host [role="status"]')).toContainText('Synthetic local reset unavailable');
        await expect(page.locator('#discard-old-local')).toBeEnabled();
        assert.deepEqual(await legacy(), before); unchangedCloud(); assert.deepEqual(localResets, []);
        await page.locator('#discard-old-local').click();
        await expect(page.locator('#source-reset-dialog')).toBeVisible({ timeout: 15000 });
        assert.deepEqual(localResets, [profileId]);
        assert.equal((await legacy()).google, null);
      } else {
        await expect(page.locator('#source-reset-dialog')).toBeVisible();
      }
      await page.getByRole('button', { name: t('sync.recovery.reset'), exact: true }).click();
      await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
      await expect(page.locator('#settings-account-name')).toHaveText(email);
      unchangedCloud(); assert.deepEqual((await legacy()).local, before.local);
      await page.locator('#reset-data').click();
      await expect(page.locator('#reset-data-dialog')).toContainText(email);
      await expect(page.locator('#reset-data-dialog')).toContainText(t('backup.reset.updateDevices'));
      await expect(page.locator('#confirm-reset-data')).toBeDisabled();
      await page.locator('#reset-data-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
      unchangedCloud();
      await page.locator('#reset-data').click(); await page.locator('#reset-agree').check();
      await page.locator('#confirm-reset-data').click();
      await expect(page.locator('#reset-data-dialog')).toHaveCount(0, { timeout: 15000 });
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
      await page.locator('#settings-button').click(); await page.locator('#settings-dialog [data-page="account"]').click();
      await page.locator('#google-sync').click();
      await expect.poll(() => [...provider.files.values()].some(item => item.file.kind === 'revision'
        && new TextDecoder().decode(item.bytes).includes('First new note after reset')), { timeout: 15000 }).toBe(true);
      assert.deepEqual(errors, []); assert.deepEqual(oldReads, []);
      console.log(`PASS ${engine}: ${oldLocal ? 'legacy' : 'empty'} local profile + signed-in legacy Google, Settings consent/cancel, metadata-only reset, zero notes and new note sync.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
