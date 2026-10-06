/** Isolated real-browser backup UI regression. Usage: node scripts/testing/restore-ui-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/restore-ui-probe.mjs --url http://127.0.0.1:PORT\nUses synthetic notes and real origin-private files in an isolated browser profile; no personal file picker or account.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html'; const profile = `restore-ui-${crypto.randomUUID()}`; base.searchParams.set('profile', profile);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => {
  window.probeFiles = []; window.probePickers = [];
  // The picker is replaced, but writes/close/getFile use the browser's actual FileSystemFileHandle implementation.
  window.showSaveFilePicker = async options => {
    window.probePickers.push({ name: options.suggestedName, activated: navigator.userActivation.isActive });
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`probe-${window.probePickers.length}.zip`, { create: true });
    window.probeFiles.push(handle); return handle;
  };
});
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const read = () => page.evaluate(async profileId => {
  const { IndexedDbStorage } = await import('/storage/indexed-db.js');
  const storage = await IndexedDbStorage.open(); const result = await storage.load(profileId); storage.close(); return result;
}, profile);
const savedBytes = async () => Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await window.probeFiles.at(-1).getFile()).arrayBuffer()))));
// Backup is the 資料與備份 page of settings; narrow viewports reach the gear through the drawer.
const openDialog = async () => { if (await page.locator('#drawer-toggle').isVisible()) await page.locator('#drawer-toggle').click();
  await page.locator('#settings-button').click(); await page.locator('[data-page="data"]').click(); await expect(page.locator('#backup-panel')).toBeVisible(); };
const moreOptions = async () => { const details = page.locator('.restore-options'); if (!await details.evaluate(node => node.open)) await details.locator('summary').click(); };
const choose = async buffer => { await page.locator('#restore-file').setInputFiles({ name: 'synthetic-backup.zip', mimeType: 'application/zip', buffer }); };
const preview = async () => { await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toContainText('確認還原'); };
const capture = async text => {
  await page.locator('#new-card').click(); await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: '保存便箋', exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
try {
  await page.goto(base.href); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await capture('備份原始便箋 中文💡');
  await page.locator('#new-card').click(); await page.locator('#editor-text').fill('還原後仍保留的草稿');
  await page.locator('#keep-draft').click();
  await openDialog(); const before = await read();
  await page.locator('#backup-encrypt').uncheck(); await page.locator('#export-backup').click();
  await expect(page.locator('#backup-status')).toHaveText('備份已保存，檔案檢查無誤。'); const plain = await savedBytes();
  await page.locator('#backup-encrypt').check(); await page.locator('#backup-password').fill('long password 中文💡');
  await page.locator('#export-backup').click(); await expect(page.locator('#backup-status')).toHaveText('備份已保存，檔案檢查無誤。');
  const encrypted = await savedBytes(); await expect(page.locator('#backup-password')).toHaveValue('');
  assert.deepEqual(await read(), before, 'export has no workspace writes');
  await choose(encrypted); await page.locator('#restore-password').fill('wrong'); await page.locator('#preview-restore').click();
  await expect(page.locator('#backup-status')).toHaveClass(/error/); await expect(page.locator('#confirm-restore')).toBeDisabled();
  assert.deepEqual(await read(), before, 'wrong password has no workspace writes');
  await page.locator('#restore-password').fill('long password 中文💡'); await preview();
  await expect(page.locator('#restore-preview')).toContainText('1 張便箋');
  await page.locator('#close-settings').click(); assert.deepEqual(await read(), before, 'closing preview has no writes');
  await openDialog(); await choose(encrypted); await page.locator('#restore-password').fill('long password 中文💡');
  await moreOptions(); await page.locator('#restore-layout').check(); await preview();
  await page.locator('#confirm-restore').click(); await expect(page.locator('#backup-status')).toContainText('已還原');
  let state = await read(); assert.equal(state.cards.length, 2); assert.equal(Object.keys(state.drafts).length, 2);
  assert.equal(Object.keys(state.restoreReceipts).length, 1); assert.deepEqual(state.cards.find(card => card.id === before.cards[0].id), before.cards[0]);
  await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toHaveClass(/error/);
  await expect(page.locator('#confirm-restore')).toBeDisabled(); assert.deepEqual(await read(), state, 'same backup is not silently imported twice');
  await moreOptions(); await page.locator('#restore-repeat').check(); await preview(); await page.locator('#close-settings').click();
  await capture('取代時移至刪除區的額外便箋');
  await openDialog(); await choose(plain); await page.locator('#restore-mode').selectOption('replace');
  await moreOptions(); await page.locator('#restore-layout').check(); await preview(); const beforeReplace = await read();
  await expect(page.locator('#restore-preview')).toContainText('2 張便箋會移到刪除區');
  await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#save-safety-backup').click(); await expect(page.locator('#backup-status')).toContainText('至少需要 12');
  await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#backup-password').fill('safety password 中文💡'); await page.locator('#save-safety-backup').click();
  await expect(page.locator('#backup-status')).toContainText('可以確認取代'); await expect(page.locator('#confirm-restore')).toBeEnabled();
  const safety = await page.evaluate(async () => {
    const { openBackup } = await import('/backup/payload.js');
    return (await openBackup(new Uint8Array(await (await window.probeFiles.at(-1).getFile()).arrayBuffer()), { password: 'safety password 中文💡' })).data;
  });
  assert.deepEqual(safety.records, beforeReplace.revisions); assert.deepEqual(await read(), beforeReplace);
  await page.locator('#confirm-restore').click(); await expect(page.locator('#backup-status')).toContainText('已還原');
  state = await read(); assert.equal(state.cards.filter(card => !card.deleted).length, 1);
  assert.equal(state.cards.filter(card => card.deleted).length, 2); assert.equal(Object.keys(state.restoreReceipts).length, 2);
  for (const [id, draft] of Object.entries(beforeReplace.drafts)) assert.deepEqual(state.drafts[id], draft);
  assert.ok(state.revisions.length > beforeReplace.revisions.length, 'replace appends history');
  await choose(Buffer.from('not a backup')); await page.locator('#preview-restore').click();
  await expect(page.locator('#backup-status')).toHaveClass(/error/); assert.deepEqual(await read(), state, 'invalid input has no writes');
  assert.ok((await page.evaluate(() => window.probePickers)).every(item => item.activated), 'picker must retain click activation');
  await page.locator('#close-settings').click(); await page.setViewportSize({ width: 390, height: 844 });
  await openDialog(); await choose(plain); await moreOptions(); await page.locator('#restore-repeat').check(); await preview();
  const geometry = await page.locator('#settings-dialog').evaluate(dialog => ({ client: dialog.clientWidth, scroll: dialog.scrollWidth,
    left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right, viewport: innerWidth }));
  assert.ok(geometry.scroll <= geometry.client + 1 && geometry.left >= 0 && geometry.right <= geometry.viewport, 'narrow dialog must not overflow');
  await page.screenshot({ path: 'build/restore-ui-probe.png' });
  await page.locator('#close-settings').click(); await page.reload(); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  assert.equal(Object.keys((await read()).restoreReceipts).length, 2); assert.deepEqual(errors, []);
  console.log('PASS: real OPFS save/readback, encrypted export, wrong password, preview cancellation, import/repeat, safety-gated replace, retained drafts/history, restart receipts and 390px UI');
} catch (error) {
  await page.screenshot({ path: 'build/restore-ui-probe-failure.png' }); throw error;
} finally { await context.close(); await browser.close(); }
