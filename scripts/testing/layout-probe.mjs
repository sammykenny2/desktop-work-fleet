/** Layout rules every screen shares, in real browsers. Usage: node scripts/testing/layout-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW] */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setLocale, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/layout-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW]\nChecks at computer and phone widths that dropdowns match text fields, that dialogs keep their management actions apart from their answer, and that every settings page fits and starts at the top with the Data and backup page in cards, including its automatic backup and checked-file states. A synthetic desktop host checks that the layout map is not offered. Uses isolated profiles and writes pictures to build/layout-probe.');
  process.exit(0);
}
const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const base = new URL(arg('--url'));
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html';
const engine = arg('--browser', 'chromium'); assert.ok(['chromium', 'webkit'].includes(engine));
const locale = arg('--locale', 'en'); assert.ok(['en', 'zh-TW'].includes(locale)); setLocale(locale);
const output = 'build/layout-probe'; await mkdir(output, { recursive: true });
const browser = await ({ chromium, webkit })[engine].launch();

const rect = locator => locator.evaluate(node => { const { top, right, bottom, left, height } = node.getBoundingClientRect(); return { top, right, bottom, left, height }; });
const button = (page, name) => page.locator('dialog[open]').getByRole('button', { name, exact: true });
const opened = page => expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
const clearToasts = page => page.evaluate(() => { for (const close of document.querySelectorAll('.toast-close')) close.click(); });
const noDialog = page => page.evaluate(() => { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); });

function browserPage(context, phone) {
  const openDrawer = async page => { if (phone && !await page.evaluate(() => document.body.classList.contains('drawer-open'))) await page.locator('#drawer-toggle').click(); };
  const closeDrawer = async page => { if (phone && await page.evaluate(() => document.body.classList.contains('drawer-open'))) await page.mouse.click(page.viewportSize().width - 6, 400); };
  const capture = async (page, text) => {
    await closeDrawer(page);
    if (await page.locator('.first-note').count()) await page.locator('.first-note button').click();
    else { await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); }
    await page.locator('#editor-text').fill(text); await page.locator('#editor-form button[type=submit]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();
  };
  return { openDrawer, closeDrawer, capture };
}

async function checkWidth(width, height) {
  const phone = width <= 640;
  const context = await browser.newContext({ viewport: { width, height }, locale, acceptDownloads: true });
  // The checked-file state needs a real backup, which needs somewhere to save it.
  await context.addInitScript(() => {
    window.probeFiles = [];
    window.showSaveFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(`layout-${window.probeFiles.length}.zip`, { create: true }); window.probeFiles.push(handle); return handle;
    };
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const { openDrawer, closeDrawer, capture } = browserPage(context, phone);
  const url = new URL(base); url.searchParams.set('profile', `layout-${crypto.randomUUID()}`);
  await page.goto(url.href); await opened(page);
  await capture(page, 'First note'); await openDrawer(page);
  await page.locator('#add-group').click(); await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Second');
  await page.locator('dialog[open] button[type=submit]').click(); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await capture(page, 'Second note');

  // A dropdown is as tall as the text field beside it, on the engine that used to draw it flat too.
  await page.locator('[data-view="board"]').click(); await page.locator('#compose').click();
  const select = await rect(page.locator('#editor-group')), field = await rect(page.locator('#editor-heading'));
  assert.ok(select.height >= 36, `a dropdown is ${select.height} px tall`);
  assert.ok(Math.abs(select.height - field.height) <= 2, `a dropdown (${select.height}) matches a text field (${field.height})`);
  assert.equal(await page.locator('#editor-group').evaluate(node => getComputedStyle(node).appearance), 'none');
  assert.match(await page.locator('#editor-group').evaluate(node => getComputedStyle(node).backgroundImage), /gradient/);
  // A toast stays off the action row, also once the dialog has scrolled it into view.
  await page.evaluate(async () => { const { notifications } = await import('/app/notifications.js'); notifications().show('Layout probe', { id: 'layout' }); });
  await page.locator('#editor-dialog').evaluate(node => node.scrollTo(0, node.scrollHeight));
  await expect.poll(() => page.locator('#editor-form button[type=submit]').evaluate(node => {
    const box = node.getBoundingClientRect(); return node === document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  })).toBe(true);
  await clearToasts(page); await page.locator('#close-editor-button').click(); await noDialog(page);

  // Group settings: Delete and Merge sit together, apart from Cancel and Save.
  const inCluster = async (first, second, answer, confirm) => {
    const [a, b, c, d] = await Promise.all([first, second, answer, confirm].map(rect));
    assert.equal(a.top, b.top, 'management actions share a row'); assert.equal(c.top, d.top, 'the answers share a row');
    assert.ok(b.left - a.right <= 12, 'management actions are neighbours');
    if (phone) assert.ok(c.top > a.bottom, 'on a phone the answers have their own row below');
    else { assert.equal(a.top, c.top, 'one row on a computer'); assert.ok(c.left - b.right >= 24, 'space divides management from the answers'); }
  };
  await openDrawer(page); await page.locator('#groups .group-menu').first().click();
  await inCluster(button(page, t('app.groupEditor.delete')), button(page, t('app.groupEditor.merge')), button(page, t('common.cancel')), button(page, t('common.save')));
  for (const control of await page.locator('dialog[open] .dialog-actions button').all()) await expect(control).toBeInViewport();
  const swatch = await rect(page.locator('dialog[open] .swatch input').first()); assert.ok(swatch.height <= 28, `a colour's target stays its own size (${swatch.height} px)`);
  await clearToasts(page); await page.screenshot({ path: `${output}/${engine}-${locale}-${width}-group.png`, animations: 'disabled' }); await noDialog(page); await closeDrawer(page);

  // Note details keep the same split.
  await page.locator('#list [data-card-id]').first().hover(); await page.locator('#list [data-card-id]').first().getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await inCluster(button(page, t('app.card.edit')), button(page, t('app.card.archive')), button(page, t('common.cancel')), button(page, t('app.card.apply')));
  await clearToasts(page); await page.screenshot({ path: `${output}/${engine}-${locale}-${width}-note.png`, animations: 'disabled' }); await noDialog(page);

  // Every settings page fits its width and starts at the top.
  await openDrawer(page); await page.locator('#settings-button').click();
  const back = async () => { if (phone) await page.locator('#settings-back').click(); };
  for (const name of ['general', 'account', 'desktop', 'shortcuts', 'revisions', 'data']) {
    await page.locator(`[data-page="${name}"]`).click();
    const shown = page.locator(`[data-panel="${name}"]`); await expect(shown).toBeVisible();
    if (name === 'data') await expect(page.locator('#backup-panel')).toBeVisible();
    const fit = await page.evaluate(selector => {
      const body = document.querySelector('.settings-body'); const content = document.querySelector(selector).querySelector(':scope *:not([hidden])');
      return { overflow: body.scrollWidth - body.clientWidth, gap: content.getBoundingClientRect().top - document.querySelector('.settings-head').getBoundingClientRect().bottom };
    }, `[data-panel="${name}"]`);
    assert.ok(fit.overflow <= 0, `${name} overflows by ${fit.overflow} px`); assert.ok(fit.gap <= 28, `${name} starts ${fit.gap} px down`);
    if (name !== 'data') await back();
  }

  // Data and backup is cards of rows like the other pages, and a password row shows only while it counts.
  const loose = await page.locator('#backup-panel').evaluate(panel => [...panel.querySelectorAll('input,select')].filter(control => !control.closest('.settings-row')).map(control => control.id));
  assert.deepEqual(loose, [], 'every control is in a row');
  await expect(page.locator('#backup-password')).toBeVisible();
  const coverage = await rect(page.locator('#backup-coverage')), secret = await rect(page.locator('#backup-password'));
  assert.ok(Math.abs(coverage.height - secret.height) <= 2, `settings controls match (${coverage.height}, ${secret.height})`);
  // A toast stays off the page's actions wherever scrolling brings them, and off the swatches' row the radios stay their own size.
  await page.evaluate(async () => { const { notifications } = await import('/app/notifications.js'); notifications().show('Layout probe\nsecond line\nthird line', { id: 'layout-data', kind: 'error' }); });
  for (const id of ['#export-backup', '#preview-restore']) {
    await page.locator(id).evaluate(node => node.scrollIntoView({ block: 'end' }));
    await expect.poll(() => page.locator(id).evaluate(node => {
      const box = node.getBoundingClientRect(); return node === document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    })).toBe(true);
  }
  await clearToasts(page); await page.locator('.settings-body').evaluate(node => node.scrollTo(0, 0));
  await page.locator('#backup-encrypt').setChecked(false, { force: true }); await expect(page.locator('#backup-password')).toBeHidden();
  await page.locator('#restore-mode').selectOption('local-replace'); await expect(page.locator('#restore-local-agree')).toBeVisible();
  await expect(page.locator('#confirm-restore')).toBeHidden();
  await clearToasts(page); await page.screenshot({ path: `${output}/${engine}-${locale}-${width}-data.png`, animations: 'disabled' });

  // A checked file answers in a card of its own, with what confirming needs. The saving picker is Chromium's.
  if (engine === 'chromium') {
    await page.locator('#export-backup').click();
    await expect(page.locator('.toast[data-notice-id^=backup] .toast-message')).toContainText(t('backup.export.saved'));
    const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await window.probeFiles.at(-1).getFile()).arrayBuffer())));
    await page.locator('#restore-file').setInputFiles({ name: 'layout.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await page.locator('#preview-restore').click();
    await expect(page.locator('.toast[data-notice-id^=backup] .toast-message')).toHaveText(t('backup.restore.ready'));
    await expect(page.locator('#restore-preview')).toBeVisible(); await expect(page.locator('#confirm-restore')).toBeVisible(); await expect(page.locator('#save-safety-backup')).toBeVisible();
    assert.notEqual(await page.locator('#restore-preview').evaluate(node => node.closest('.settings-list') === document.querySelector('#restore-mode').closest('.settings-list')), true);
    await clearToasts(page); await page.locator('#confirm-restore').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${engine}-${locale}-${width}-data-checked.png`, animations: 'disabled' });
  }

  // With automatic backup set up, the same section shows each setting in a row and the answer at its end.
  await page.evaluate(async () => {
    const { automaticBackupSection } = await import('/app/automatic-backup.js');
    const status = { phase: 'idle', enabled: true, paused: false, error: null, pending: null, canEncrypt: true, canCreate: true, canPrune: true,
      settings: { keep: 7, encrypted: true, destinationName: 'Backups', destinationId: 'probe', keyId: 'probe' }, lastSuccess: { savedAt: new Date().toISOString() },
      inventory: [{ status: 'unconfirmed', createdAt: new Date().toISOString(), name: 'unconfirmed.zip' }] };
    const section = automaticBackupSection({ files: { available: true }, vault: {}, service: { status, subscribe(callback) { callback(status); return () => {}; } } });
    document.querySelector('#automatic-backup').replaceWith(section.element);
  });
  for (const id of ['location', 'keep', 'encrypt', 'password', 'now', 'enable', 'disable']) await expect(page.locator(`#auto-backup-${id}`)).toBeVisible();
  const off = await rect(page.locator('#auto-backup-disable')), on = await rect(page.locator('#auto-backup-enable'));
  assert.ok(off.right < on.left || off.bottom <= on.top, 'turning backup off stays apart from saving its settings, on a row of its own if the words need it');
  assert.equal(await page.evaluate(() => { const body = document.querySelector('.settings-body'); return body.scrollWidth - body.clientWidth; }), 0);
  await page.locator('.settings-body').evaluate(node => node.scrollTo(0, 0)); await clearToasts(page);
  await page.screenshot({ path: `${output}/${engine}-${locale}-${width}-data-automatic.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await context.close();
}

// A desktop host arranges on the desktop itself, and the layout map is not offered until it is built.
async function checkDesktopHost() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale });
  const profile = 'local-layout-probe';
  await context.route(/\/native\/bridge\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    export const profileBridge = bridge => bridge;
    export async function connectNative() {
      return { info: { profileId: '${profile}', platform: 'linux', appVersion: '0.4.0', capabilities: { recordStorage: true, desktopPresentation: true } },
        bridge: { onEvent() { return () => {}; }, onCloseRequested() { return () => {}; }, async request(method, params = {}) {
          if (method === 'desktop.info') return { sessionId: '00000000-0000-4000-8000-000000000001', topology: 0, views: [{ viewId: '00000000-0000-4000-8000-000000000002', layer: 'floating', active: true, viewport: { x: 0, y: 0, width: 1280, height: 800 } }], layers: ['desktop', 'floating'], adjustOverlay: true, workAreas: [{ x: 0, y: 0, width: 1280, height: 800, primary: true }] };
          if (method === 'desktop.shortcuts.configure') return { registrations: [] };
          if (method === 'desktop.frame.begin') return { token: 'frame' };
          if (method === 'desktop.frame.append') return { offset: params.offset + atob(params.base64).length };
          return {};
        } } };
    }` }));
  await context.route(/\/storage\/records-native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
    const store = await IndexedDbRecordStore.open();
    export class NativeRecordStore {
      constructor() { return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, (...args) => store[key](...args)])); }
    }` }));
  await context.route(/\/storage\/native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    export { NativeTransfers } from '/storage/native.js?original=1';
    import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
    const journal = await IndexedDbBackupJournal.open();
    export class NativeStorage { journal() { return journal; } close() {} }` }));
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = new URL(base); url.searchParams.set('profile', profile);
  await page.goto(url.href); await opened(page);
  const { capture } = browserPage(context, false); await capture(page, 'Desktop host note');

  await expect(page.locator('[data-view="board"]')).toBeVisible(); await expect(page.locator('[data-view="list"]')).toBeVisible();
  await expect(page.locator('[data-view="desktop"]')).toBeHidden(); await expect(page.locator('#layout-map')).toBeHidden();
  await page.locator('[data-view="list"]').click(); await page.locator('[data-view="board"]').click();
  await expect(page.locator('[data-view="desktop"]')).toBeHidden(); await expect(page.locator('#layout-map')).toBeHidden();

  // Trash has no group to adjust, but Adjust all works from there as its shortcut does.
  await page.locator('#groups .trash-row button').click();
  await expect(page.locator('#operate-group')).toBeDisabled(); await expect(page.locator('#operate-all')).toBeEnabled();
  await expect(page.locator('[data-view="desktop"]')).toBeHidden();
  const adjusting = () => page.evaluate(() => document.documentElement.inert);
  await page.locator('#operate-all').click(); await expect.poll(adjusting).toBe(true);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await expect.poll(adjusting).toBe(false);
  await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title'));
  await page.locator('#groups .group-row[data-group-id] button').first().click();

  // The dropdowns this host adds to group settings match the rest.
  await page.locator('#groups .group-menu').first().click();
  const layer = page.locator('dialog[open] select').first(); assert.ok((await rect(layer)).height >= 36);
  await clearToasts(page); await page.screenshot({ path: `${output}/${engine}-${locale}-host-group.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await context.close();
}

try {
  await checkWidth(1280, 800); await checkWidth(860, 700); await checkWidth(390, 844); await checkWidth(320, 700);
  await checkDesktopHost();
  console.log(`PASS ${engine} ${locale}: dropdowns match text fields; dialogs keep management apart from their answer; settings pages fit, start at the top and the data page is cards, in each of its states; desktop hosts do not offer the layout map and Trash keeps Adjust all`);
} finally { await browser.close(); }
