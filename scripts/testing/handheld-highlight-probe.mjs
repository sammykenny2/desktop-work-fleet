/** Phones neither offer nor show group highlights. Production renderer, synthetic host. Usage: node scripts/testing/handheld-highlight-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/handheld-highlight-probe.mjs --url http://127.0.0.1:PORT\nHighlights a group on a synthetic computer host, reopens the same stored notes as Android and as iOS, and checks that the phone shows no checkbox, star or edge, keeps the stored highlight when the group is saved, and that a computer shows it again. Uses isolated browser contexts and no account; it does not run a native host.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const profile = 'local-highlight-probe';
base.pathname = '/app/index.html'; base.searchParams.set('profile', profile);

const bridgeModule = platform => `
export const profileBridge = bridge => bridge;
export async function connectNative() {
  return { info: { profileId: '${profile}', platform: '${platform}', appVersion: '0.4.0', capabilities: { recordStorage: true } },
    bridge: { onEvent() { return () => {}; }, onCloseRequested() { return () => {}; }, async request() { return {}; } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() { return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, (...args) => store[key](...args)])); }
}`;
const storageModule = `
export { NativeTransfers } from '/storage/native.js?original=1';
import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
const journal = await IndexedDbBackupJournal.open();
export class NativeStorage { journal() { return journal; } close() {} }`;

async function check(engine, platform) {
  const browser = await ({ chromium, webkit })[engine].launch();
  try {
    // The same browser context keeps the stored notes, so a reload as a phone sees what a restored computer layout holds.
    let hostPlatform = 'linux';
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
    await context.route(/\/native\/bridge\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: bridgeModule(hostPlatform) }));
    await context.route(/\/storage\/records-native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: recordsModule }));
    await context.route(/\/storage\/native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: storageModule }));
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const opened = () => expect(page.locator('#status')).toHaveText(t('app.status.opened'), { timeout: 15_000 });
    const stored = () => page.evaluate(async profile => {
      const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
      const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
      const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
      try { return (await storage.load(profile)).layout.groupHighlights; } finally { storage.close(); }
    }, profile);
    const checkbox = () => page.locator('dialog[open]').getByRole('checkbox', { name: t('app.groupEditor.highlight'), exact: true });
    const save = async () => {
      await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    };
    const groupMenu = page.locator('#groups .group-row[data-group-id] .group-menu');

    // On a computer the checkbox, the star and the edge all work, which shows the phone checks below can fail.
    await page.goto(base.href); await opened();
    await page.locator('.first-note button').click(); await page.locator('#editor-text').fill('Highlighted note');
    await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
    const groupId = await page.locator('#groups .group-row[data-group-id]').first().getAttribute('data-group-id');
    await groupMenu.click(); await checkbox().setChecked(true); await save();
    await expect(page.locator('#groups .group-star')).toHaveCount(1); await expect(page.locator('.note-paper.mine')).toHaveCount(1);
    assert.deepEqual(await stored(), { [groupId]: true });

    // On a phone the stored highlight shows nowhere and the group's settings do not offer it.
    hostPlatform = platform; await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await opened();
    await expect(page.locator('#groups .group-star')).toHaveCount(0); await expect(page.locator('#groups .group-dot')).toHaveCount(1);
    await expect(page.locator('.note-paper')).toHaveCount(1); await expect(page.locator('.note-paper.mine')).toHaveCount(0);
    await page.locator('[data-view="list"]').click();
    await expect(page.locator('.note-row')).toHaveCount(1); await expect(page.locator('.note-row.mine')).toHaveCount(0);
    await page.locator('#drawer-toggle').click(); await groupMenu.click();
    await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(checkbox()).toHaveCount(0);
    await expect(page.locator('dialog[open]').getByText(t('app.groupEditor.highlightHint'), { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `build/handheld-highlight-${platform}.png` });

    // Saving the group there leaves the stored value alone, so a backup made on the phone keeps it.
    await save(); assert.deepEqual(await stored(), { [groupId]: true });

    // Back on a computer, the same value shows again.
    hostPlatform = 'linux'; await page.setViewportSize({ width: 1200, height: 900 }); await page.reload(); await opened();
    await expect(page.locator('#groups .group-star')).toHaveCount(1); await expect(page.locator('.mine')).toHaveCount(1);
    assert.deepEqual(errors, []);
    console.log(`PASS ${engine}/${platform}: the phone shows no highlight and keeps the stored value; a computer shows it again.`);
  } finally { await browser.close(); }
}

await check('chromium', 'android');
await check('webkit', 'ios');
