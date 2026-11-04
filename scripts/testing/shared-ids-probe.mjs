/** Ids two collections share, arriving by sync after the start (ADR-066). Production UI and DatasetSync; synthetic host and Drive. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { DatasetTestProvider } from '../../tests/fixtures/dataset/provider.js';
import { Workspace } from '../../src/core/workspace.js';
import { WorkspaceRecordStorage } from '../../src/storage/workspace-records.js';
import { MemoryRecordStore } from '../../src/storage/records.js';
import { DatasetSync } from '../../src/sources/dataset-sync.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/shared-ids-probe.mjs --url http://127.0.0.1:PORT\nOpens cloud and local notes, lets a synthetic Drive deliver a note with the id of a local note, and checks that the page reopens with Local notes set aside and that deleting the cloud note leaves the local one alone. Uses an isolated browser profile and no account; it does not run a native host.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const cloud = 'google:test', local = 'local-shared-ids-probe';

const bridgeModule = `
export const profileBridge = bridge => bridge;
export async function connectNative() {
  const events = new Map();
  window.fixtureHostEvent = (type, message = {}) => { for (const callback of events.get(type) ?? []) callback(message); };
  return { info: { profileId: '${cloud}', companionProfile: '${local}', platform: 'linux', appVersion: '0.4.0',
    capabilities: { recordStorage: true, googleFiles: true } },
    bridge: { onEvent(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback); return () => events.get(type).delete(callback);
      }, onCloseRequested() { return () => {}; },
      async request(method) {
        if (method === 'google.status') return { connected: true, configured: true, accountId: 'test', email: 'probe@example.invalid' };
        return {};
      } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() {
    const methods = Object.fromEntries(['status', 'get', 'page', 'getAttachment', 'close'].map(key => [key, (...args) => store[key](...args)]));
    methods.commit = async (...args) => {
      const transaction = args[0];
      if (window.fixtureHoldCollisionWrite && transaction.profileId === '${cloud}' && transaction.puts.some(row => row.collection === 'current' && row.value.entityId === window.fixtureCollidingId)) {
        window.fixtureCollisionWriting = true;
        await new Promise(resolve => { window.fixtureReleaseCollision = resolve; });
      }
      if (window.fixtureFailDraftSave && transaction.profileId === '${local}' && transaction.puts.some(row => row.collection === 'draft')) throw new Error('Synthetic disk full');
      return store.commit(...args);
    };
    return methods;
  }
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

const content = text => ({ format: 'markdown', text, attachments: [] });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
try {
  const provider = new DatasetTestProvider(); const errors = [];
  const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), cloud);
  const peer = await Workspace.create({ profileId: cloud, deviceId: 'other-device', current: true, bootstrapGroup: false,
    area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
  const peerSync = new DatasetSync({ workspace: peer, storage, fileStore: provider }); await peerSync.sync();
  const peerPull = async () => { do await peerSync.sync({ force: true }); while (peer.pendingCount); };
  await peer.createCard(content('Existing cloud note')); await peerPull();
  const peerGroup = peer.snapshot.groups[0];

  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
  await context.exposeFunction('fixtureDrive', async (method, args) => {
    try {
      if (args.bytes) args.bytes = Uint8Array.from(args.bytes);
      const result = method === 'allocateFileIds' ? await Promise.all(Array.from({ length: args.count }, () => provider.allocateFileId())) : await provider[method](args);
      return { ok: true, value: result instanceof Uint8Array ? Array.from(result) : result };
    } catch (error) { return { ok: false, code: error.code, message: error.message }; }
  });
  for (const [path, body] of [['native/bridge', bridgeModule], ['storage/records-native', recordsModule], ['storage/native', storageModule], ['native/google', googleModule]]) {
    await context.route(new RegExp(`/${path}\\.js$`), route => route.fulfill({ contentType: 'text/javascript', body }));
  }
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const section = id => page.locator(`#groups .side-section[data-profile="${id}"]`);
  const note = text => page.locator('#list [data-card-id]', { hasText: text });
  const stored = id => page.evaluate(async ({ profile, id }) => {
    const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
    const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
    const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
    try {
      const state = await storage.load(profile); const card = state.cards.find(item => item.id === id);
      return { text: card.content.text, deleted: card.deleted, unsaved: Object.values(state.drafts).find(draft => draft.cardId === id)?.content.text ?? null };
    } finally { storage.close(); }
  }, { profile: local, id });

  await page.goto(`${base.origin}/app/index.html?profile=${encodeURIComponent(cloud)}`);
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 15000 });
  await expect(page.locator('#groups .group-row[data-group-id]')).toHaveCount(1);

  // A note in Local notes, whose id then reaches the account from another device, as one backup restored into both would.
  await section(local).locator('.section-label button').click();
  await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Home');
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click(); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); await page.locator('#editor-text').fill('Local note');
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  const id = await note('Local note').getAttribute('data-card-id');
  await peer.adoptCard({ id, groupId: peerGroup.id, content: content('Cloud note with the same id'), archived: false, completed: false }); await peerPull();

  // A landing can already be writing when an editor opens. Its failed flush must keep the latest text and the page alive.
  await page.evaluate(id => {
    window.fixtureBeforeLanding = true; window.fixtureHoldCollisionWrite = true; window.fixtureCollidingId = id;
    window.fixtureHostEvent('host-foreground');
  }, id);
  await expect.poll(() => page.evaluate(() => window.fixtureCollisionWriting)).toBe(true);
  await note('Local note').dblclick(); await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.evaluate(() => { window.fixtureFailDraftSave = true; });
  await page.locator('#editor-text').fill('Latest local text that could not be saved');
  await expect(page.locator('#draft-status')).toContainText('Synthetic disk full');
  await page.evaluate(() => { window.fixtureHoldCollisionWrite = false; window.fixtureReleaseCollision(); });
  const recovery = page.locator('#shared-ids-recovery'); await expect(recovery).toBeVisible();
  await expect(recovery.locator('textarea')).toHaveValue('Latest local text that could not be saved');
  assert.equal(await page.evaluate(() => window.fixtureBeforeLanding), true, 'a failed save keeps the page');
  await recovery.getByRole('button', { name: t('common.retry'), exact: true }).click();
  await expect(recovery.getByRole('button', { name: t('common.retry'), exact: true })).toBeEnabled();
  await expect(recovery).toBeVisible();
  await page.screenshot({ path: 'build/shared-ids-recovery.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(recovery.locator('textarea')).toBeInViewport();
  await expect(recovery.getByRole('button', { name: t('common.retry'), exact: true })).toBeInViewport();
  await page.screenshot({ path: 'build/shared-ids-recovery-phone.png' });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => { window.fixtureFailDraftSave = false; });
  await recovery.getByRole('button', { name: t('common.retry'), exact: true }).click();

  // After a successful retry the start's own check sets Local notes aside with its explanation.
  await expect(section(local)).toContainText(t('app.sections.sharedIds'), { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.fixtureBeforeLanding), undefined, 'the page reopened');
  await expect(section(local).locator('.group-row')).toHaveCount(0);
  await page.screenshot({ path: 'build/shared-ids.png' });

  // It reopens only once: nothing is shared among what stays open.
  await page.evaluate(() => { window.fixtureSettled = true; }); await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.fixtureSettled), true, 'the page must not keep reopening');

  // Only the account's note can be reached now, and deleting it leaves the local one alone.
  await page.locator('#groups .group-row[data-group-id]').first().locator('button').first().click();
  await page.locator('[data-view="board"]').click(); await expect(note('Cloud note with the same id')).toBeVisible();
  await note('Cloud note with the same id').hover(); await note('Cloud note with the same id').getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.delete'), exact: true }).click(); await expect(note('Cloud note with the same id')).toHaveCount(0);
  await expect.poll(async () => (await stored(id))).toEqual({ text: 'Local note', deleted: false, unsaved: 'Latest local text that could not be saved' });
  await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/);
  await expect.poll(async () => { await peerPull(); return peer.cardValue(id).deleted; }, { timeout: 15000 }).toBe(true);
  assert.deepEqual(errors, []);
  console.log('PASS: ids shared by a later sync reopen the page with Local notes set aside once, and a delete reaches only the account.');
} finally { await browser.close(); }
