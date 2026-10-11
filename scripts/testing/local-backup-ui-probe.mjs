/** Isolated local replacement and Google export UI probe. Usage: node scripts/testing/local-backup-ui-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/local-backup-ui-probe.mjs --url http://127.0.0.1:PORT\nUses isolated IndexedDB and synthetic Google sync. No user notes or Google account.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext();
const fixture = (await readFile(new URL('../../tests/fixtures/file-store.js', import.meta.url), 'utf8'))
  .replace("import assert from 'node:assert/strict';", "const assert = { equal: (a, b) => { if (a !== b) throw new Error('fixture integrity'); } };")
  .replaceAll('../../src/', '/');
await context.route('**/fixtures/file-store.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
await context.route('**/app/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(new URL('/app/index.html', base).href);
  const backupBytes = await page.evaluate(async () => {
    const { Workspace } = await import('/core/workspace.js');
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { createBackup, openBackup } = await import('/backup/payload.js');
    const { backupPanel } = await import('/app/backup.js');
    const { FileSync } = await import('/sources/file-sync.js');
    const { MemoryFileStore } = await import('/fixtures/file-store.js');
    const storage = await IndexedDbStorage.open(`local-replace-ui-${crypto.randomUUID()}`);
    const area = { x: 0, y: 0, width: 1400, height: 900 };
    const create = profileId => Workspace.create({ profileId, deviceId: crypto.randomUUID(), area, persist: (s, r) => storage.save(s, r) });
    const local = await create('local'); const old = await local.createCard({ format: 'markdown', text: 'old local note' });
    const oldDraft = local.blankDraft(old.groupId); oldDraft.content.text = 'old local draft'; await local.saveDraft(oldDraft);
    const metadata = await storage.putAttachment('local', new Blob(['old attachment']));
    const cloud = await create('google:fixture'); await cloud.createCard({ format: 'markdown', text: 'cloud backup note' });
    const draft = cloud.blankDraft(cloud.snapshot.groups[0].id); draft.content.text = 'backup draft'; await cloud.saveDraft(draft);
    const backup = await createBackup({ workspace: cloud, storage });
    const sync = new FileSync({ workspace: cloud, storage, fileStore: new MemoryFileStore() });
    let saves = 0; let syncs = 0; const exported = [];
    const files = { canConfirmSave: false, chooseDestination: async () => ({ save: async value => {
      exported.push((await openBackup(value.bytes)).data); saves++; return { saved: false };
    } }) };
    const mount = (workspace, source) => {
      window.probePanel?.dispose();
      window.probePanel = backupPanel({ workspace, storage, files, getWorkAreas: () => [area], flush: async () => {},
        backupSource: source, onChanged: async () => {} }); document.body.replaceChildren(window.probePanel.element);
    };
    mount(local);
    window.mountLocal = () => mount(local);
    window.probeResult = async () => ({ state: await storage.load('local'), oldBlob: Boolean(await storage.getAttachment('local', metadata.id)),
      cloud: await storage.load('google:fixture'), saves, syncs });
    window.mountCloud = (fail = false) => mount(cloud, { target: 'synthetic@example.invalid 的 Google 工作空間', sync: async () => {
      syncs++; if (fail) throw new Error('synthetic network failure');
      await cloud.createCard({ format: 'markdown', text: 'latest synchronized note' });
      await sync.sync({ force: true });
    } });
    window.probeExports = () => exported;
    return Array.from(backup.bytes);
  });
  const choose = buffer => page.locator('#restore-file').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer });
  await page.locator('#restore-mode').selectOption('local-replace');
  await expect(page.locator('#restore-layout')).toBeChecked(); await expect(page.locator('#restore-layout')).toBeDisabled();
  await choose(Buffer.from('invalid')); await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toHaveClass(/error/);
  assert.equal((await page.evaluate(() => window.probeResult())).state.cards[0].content.text, 'old local note');
  await choose(Buffer.from(backupBytes)); await page.locator('#preview-restore').click();
  await expect(page.locator('#backup-status')).toContainText('確認還原'); await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#restore-local-agree').check(); await expect(page.locator('#confirm-restore')).toBeEnabled();
  await choose(Buffer.from(backupBytes)); await expect(page.locator('#restore-local-agree')).not.toBeChecked();
  await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toContainText('確認還原');
  await page.locator('#restore-local-agree').check(); await page.locator('#confirm-restore').click();
  await expect(page.locator('#backup-status')).toContainText('已還原');
  const result = await page.evaluate(() => window.probeResult());
  assert.deepEqual(result.state.cards.map(card => card.content.text), ['cloud backup note']);
  assert.deepEqual(Object.values(result.state.drafts).map(draft => draft.content.text), ['backup draft']);
  assert.equal(result.oldBlob, false); assert.equal(result.saves, 0); assert.equal(result.cloud.cards[0].content.text, 'cloud backup note');
  // A failed Google sync must not save a ZIP until the user explicitly accepts a known-replica snapshot.
  await page.evaluate(() => window.mountCloud(true)); await page.locator('#backup-encrypt').uncheck();
  await page.locator('#export-backup').click(); await expect(page.locator('#backup-known-data-dialog')).toBeVisible();
  assert.equal((await page.evaluate(() => window.probeResult())).saves, 0);
  await page.locator('#backup-known-data-dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('#backup-status')).toContainText('已取消'); assert.equal((await page.evaluate(() => window.probeResult())).saves, 0);
  await page.locator('#export-backup').click(); await page.locator('#export-known-data').click();
  await expect(page.locator('#backup-status')).toContainText('僅含這台已知副本');
  assert.equal((await page.evaluate(() => window.probeResult())).saves, 1);
  await page.evaluate(() => window.mountCloud()); await page.locator('#backup-encrypt').uncheck();
  await page.locator('#export-backup').click();
  await expect(page.locator('#backup-status')).toContainText('包含本次同步取得');
  await expect(page.locator('#backup-known-data-dialog')).toHaveCount(0);
  const success = await page.evaluate(() => window.probeResult());
  assert.equal(success.saves, 2); assert.ok(success.cloud.sync.lastSuccessfulSyncAt); assert.equal(success.cloud.outbox.length, 0);
  assert.ok((await page.evaluate(() => window.probeExports()))[1].records.some(record => record.value.content?.text === 'latest synchronized note'));
  assert.ok((await page.evaluate(() => window.probeExports()))[0].records.some(record => record.value.content?.text === 'cloud backup note'));
  await page.evaluate(() => window.mountCloud(true)); await page.locator('#backup-encrypt').uncheck();
  await page.locator('#export-backup').click(); await expect(page.locator('#backup-known-data-dialog')).toBeVisible();
  await page.evaluate(() => window.probePanel.abort()); await expect(page.locator('#backup-known-data-dialog')).toHaveCount(0);
  await expect(page.locator('#backup-status')).toContainText('已取消');
  assert.equal((await page.evaluate(() => window.probeResult())).saves, 2);
  await page.evaluate(() => window.mountLocal()); await choose(Buffer.from(backupBytes));
  await page.locator('#restore-mode').selectOption('local-replace');
  await page.locator('.restore-options summary').click(); await page.locator('#restore-repeat').check();
  await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toContainText('確認還原');
  await page.locator('#backup-encrypt').uncheck(); await expect(page.locator('#save-safety-backup')).toBeEnabled();
  await page.locator('#save-safety-backup').click(); await expect(page.locator('#backup-status')).toContainText('已交給瀏覽器下載目前資料');
  await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#restore-local-agree').check(); await expect(page.locator('#confirm-restore')).toBeEnabled();
  assert.equal((await page.evaluate(() => window.probeResult())).saves, 3);
  assert.deepEqual(errors, []);
  console.log('PASS local full replacement UI/IndexedDB: optional old backup, consent invalidation, exact note/draft/blob replacement and other-profile isolation; Google export syncs first, requires explicit fallback on failure and supports cancellation');
} finally { await context.close(); await browser.close(); }
