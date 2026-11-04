/** Toast geometry, modal ownership, input and expiration in isolated Chromium/WebKit profiles. */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setLocale, t } from '../../src/i18n/index.js';

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/notifications-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW] [--without-popover]');
  process.exit(0);
}
const url = new URL(option('--url', 'http://127.0.0.1:0'));
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port !== '0', '--url must be a loopback preview');
const engine = option('--browser', 'chromium'), locale = option('--locale', 'en');
assert.ok(['chromium', 'webkit'].includes(engine) && ['en', 'zh-TW'].includes(locale)); setLocale(locale);
url.pathname = '/app/index.html'; url.searchParams.set('profile', `toast-${crypto.randomUUID()}`);
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, locale });
if (process.argv.includes('--without-popover')) await context.addInitScript(() => { Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: undefined }); });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const toast = id => page.locator(`.toast[data-notice-id="${id}"]`);
const show = (text, options) => page.evaluate(async ({ text, options }) => {
  const { notifications } = await import('/app/notifications.js'); notifications().show(text, options);
}, { text, options });
const clear = () => page.evaluate(async () => { const { notifications } = await import('/app/notifications.js'); const queue = notifications(); for (const id of [...queue.items.keys()]) queue.clear(id); });
const owns = selector => expect.poll(() => page.locator('#toast-host').evaluate((host, selector) => host.parentElement.matches(selector)
  && (host.dataset.fallback === 'true' || host.matches(':popover-open') || !host.querySelector('.toast:not([hidden])')), selector)).toBe(true);
try {
  await page.goto(url.href); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page.locator('#dataset-maintenance,#backup-status,.status-line')).toHaveCount(0);
  await page.locator('#search').focus();
  const before = await page.locator('main').boundingBox();
  await show('Saved', { id: 'result' }); await expect(toast('result')).toBeVisible(); await owns('body');
  await expect(page.locator('#search')).toBeFocused(); assert.deepEqual(await page.locator('main').boundingBox(), before);
  await toast('result').getByRole('button', { name: t('common.dismissNotification') }).click(); await expect(toast('result')).toHaveCount(0);
  await expect(page.locator('#search')).toBeFocused();

  await page.locator('#settings-button').click();
  await show('A setting could not be saved', { id: 'setting', kind: 'error' }); await owns('#settings-dialog');
  await expect(toast('setting')).toBeVisible();
  await toast('setting').getByRole('button', { name: t('common.dismissNotification') }).click();
  await expect(toast('setting')).toHaveCount(0); await expect(page.locator('#settings-dialog')).toBeVisible();

  await show('Reading', { id: 'job', kind: 'progress' });
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'toast-nested'; dialog.innerHTML = '<h2>Confirm</h2><button type="button">Close fixture</button>'; dialog.querySelector('button').onclick = () => { dialog.close(); dialog.remove(); }; document.body.append(dialog); dialog.showModal(); });
  await owns('#toast-nested');
  await expect(toast('job')).toBeHidden();
  await show('<img src=x onerror="window.toastInjected=true">', { id: 'unsafe', kind: 'error' });
  await expect(toast('unsafe').locator('img,script')).toHaveCount(0); assert.equal(await page.evaluate(() => window.toastInjected), undefined);
  await toast('unsafe').getByRole('button', { name: t('common.dismissNotification') }).click();
  await page.locator('#toast-nested > button').click(); await owns('#settings-dialog');
  await expect(toast('job')).toBeVisible();
  for (let index = 0; index < 8; index++) await show(`Writing ${index}`, { id: 'job', kind: 'progress' });
  await expect(toast('job')).toHaveCount(1); await expect(toast('job').locator('.toast-message')).toHaveText('Writing 7');
  await toast('job').getByRole('button', { name: t('common.dismissNotification') }).click();
  await show('Writing 8', { id: 'job', kind: 'progress' }); await expect(toast('job')).toHaveCount(0);
  await show('Backup finished', { id: 'job' }); await expect(toast('job')).toBeVisible();
  await page.locator('#close-settings').click(); await owns('body'); await clear();

  await page.setViewportSize({ width: 390, height: 850 });
  await page.evaluate(() => {
    const dialog = document.createElement('dialog'); dialog.id = 'toast-phone-confirm';
    Object.assign(dialog.style, { height: 'calc(100dvh - 40px)', display: 'flex', flexDirection: 'column' });
    dialog.innerHTML = '<h2>Confirm fixture</h2><div class="dialog-actions" style="margin-top:auto"><button type="button">Continue fixture</button></div>';
    dialog.querySelector('button').onclick = () => { dialog.close(); dialog.remove(); };
    document.body.append(dialog); dialog.showModal();
  });
  await show('A long operation failure. '.repeat(20), { id: 'phone-confirm', kind: 'error' }); await owns('#toast-phone-confirm');
  await page.locator('#toast-phone-confirm > .dialog-actions button').click(); await owns('body'); await clear();
  await page.locator('#drawer-toggle').click(); await page.locator('#settings-button').click();
  await page.locator('#settings-dialog [data-page=data]').click();
  await page.evaluate(async ({ text, label, context }) => { const { notifications } = await import('/app/notifications.js');
    notifications().show(text, { id: 'phone-settings', kind: 'error', context, action: { label, run() {} } });
  }, { text: t('sync.reset.paused', { error: t('sync.reset.unconfirmed') }), label: t('sync.actions.resumeReset'), context: t('app.sections.cloud') });
  await owns('#settings-dialog');
  assert.ok(await toast('phone-settings').evaluate(root => {
    const copy = root.querySelector('.toast-copy').getBoundingClientRect(), action = root.querySelector('.toast-action').getBoundingClientRect();
    return copy.width >= 180 && action.top >= copy.bottom && action.right <= root.getBoundingClientRect().right;
  }), 'a long action must sit below the message without squeezing its text');
  await mkdir('build/notifications-probe', { recursive: true });
  await page.screenshot({ path: `build/notifications-probe/${engine}-${locale}-settings.png`, animations: 'disabled' });
  await page.locator('#reset-data').click();
  await expect(page.locator('#reset-data-dialog')).toBeVisible();
  await page.locator('#reset-data-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await page.locator('#close-settings').click(); await owns('body'); await clear();
  await page.setViewportSize({ width: 1200, height: 850 });

  await page.evaluate(async () => { const { notifications } = await import('/app/notifications.js'); window.toastActions = 0;
    notifications().show('Try again', { id: 'retry', kind: 'error', action: { label: 'Retry fixture', run: async () => { window.toastActions++; await new Promise(resolve => setTimeout(resolve, 100)); } } }); });
  await toast('retry').getByRole('button', { name: 'Retry fixture' }).dblclick();
  await expect(toast('retry')).toHaveCount(0); assert.equal(await page.evaluate(() => window.toastActions), 1);
  await page.evaluate(async () => { const { notifications } = await import('/app/notifications.js'); window.toastRetryAttempts = 0;
    notifications().show('Retry this operation', { id: 'failed-retry', kind: 'error', action: { label: 'Retry failure fixture', run: async () => {
      if (++window.toastRetryAttempts === 1) throw new Error('Still offline');
    } } }); });
  await toast('failed-retry').getByRole('button', { name: 'Retry failure fixture' }).click();
  await expect(toast('failed-retry').locator('.toast-message')).toHaveText('Still offline');
  await toast('failed-retry').getByRole('button', { name: 'Retry failure fixture' }).focus();
  await page.keyboard.press('Enter'); await expect(toast('failed-retry')).toHaveCount(0);
  await page.evaluate(async () => { const { notifications } = await import('/app/notifications.js');
    notifications().show('Details stay available', { id: 'navigation', kind: 'error', action: { label: 'Details fixture', keepOpen: true, run: () => { window.toastViewed = true; } } }); });
  await toast('navigation').getByRole('button', { name: 'Details fixture' }).click();
  assert.equal(await page.evaluate(() => window.toastViewed), true); await expect(toast('navigation')).toBeVisible(); await clear();

  await page.clock.install();
  await show('Expires', { id: 'expires', duration: 5000 }); await show('Keep this error', { id: 'persistent', kind: 'error' });
  await page.mouse.move(1, 1);
  await page.clock.runFor(6000); await expect(toast('expires')).toHaveCount(0); await expect(toast('persistent')).toBeVisible();
  await clear();
  for (const width of [320, 390, 1200]) {
    await page.setViewportSize({ width, height: 850 });
    await show('A long message that wraps without moving the page. '.repeat(12), { id: 'geometry', kind: 'error' });
    assert.ok(await toast('geometry').evaluate(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) { await mkdir('build/notifications-probe', { recursive: true }); await page.screenshot({ path: `build/notifications-probe/${engine}-${locale}-phone.png` }); }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine} ${locale}: nonmodal toasts, nested modal ownership and dismissal, focus, no reflow, text isolation, updated jobs, one-shot actions, timeout and phone geometry`);
} finally { await context.close(); await browser.close(); }
