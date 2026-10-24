/** The renderer as a phone app shows it. Usage: node scripts/testing/handheld-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { setLocale, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/handheld-probe.mjs --url http://127.0.0.1:PORT\nNeeds the Windows core test build. The page talks to its stdio bridge over a temporary folder; host.info says iOS or Android.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html';
const executable = path.resolve('tests/native/windows/core/bin/Debug/net10.0-windows/WorkFleet.Windows.Core.Tests.dll');
await access(executable);

// The Windows core bridge keeps the notes in a real native store; only host.info is changed so the page takes the phone
// paths. It checks the renderer, not the iOS or Android hosts.
async function phone(platform, locale) {
  const directory = path.resolve(`build/handheld-${crypto.randomUUID()}`); await mkdir(directory, { recursive: true });
  const host = spawn('dotnet', [executable, '--bridge', directory], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let failure = ''; host.stderr.on('data', bytes => { failure += bytes; });
  const exit = new Promise(resolve => host.on('exit', resolve));
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale });
  const page = await context.newPage(); const errors = []; const methods = new Map();
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('probeRelay', text => { const message = JSON.parse(text); methods.set(message.id, message.method); host.stdin.write(`${text}\n`); });
  createInterface({ input: host.stdout }).on('line', line => {
    const reply = JSON.parse(line);
    if (methods.get(reply.id) === 'host.info' && reply.ok) {
      Object.assign(reply.result, { platform, appVersion: '9.8.7', distribution: platform });
      Object.assign(reply.result.capabilities, { hostPreferences: false, updates: false, desktopPresentation: false, dataRecovery: false });
    }
    void page.evaluate(text => window.workFleet.onmessage({ data: text }), JSON.stringify(reply)).catch(() => {});
  });
  await page.addInitScript(() => { window.workFleet = { postMessage: text => window.probeRelay(text) }; });
  try {
    setLocale(locale === 'zh-TW' ? 'zh-TW' : 'en');
    await page.goto(base.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'), { timeout: 15_000 });
    // The phone apps do not zoom like a page.
    assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /maximum-scale=1, user-scalable=no/);
    // On a phone the gear opens the list of pages.
    await page.locator('#drawer-toggle').click(); await page.locator('#settings-button').click();
    await page.locator('[data-page="general"]').click(); await expect(page.locator('#settings-page-title')).toHaveText(t('settings.general.title'));
    // Every app shows its version; a phone has no update row, no startup settings and no desktop pages.
    await expect(page.locator('#version-heading')).toHaveText(t('settings.update.versionHeading'));
    await expect(page.locator('#app-version')).toHaveText(t('settings.desktop.version', { version: '9.8.7' }));
    await expect(page.locator('#app-distribution')).toHaveText(t(`settings.desktop.distribution.${platform}`));
    await expect(page.locator('#update-row')).toBeHidden(); await expect(page.locator('#host-settings')).toBeHidden();
    await expect(page.locator('[data-page="desktop"]')).toBeHidden();
    // The first heading sits at the top of the page, as on the desktop.
    const gap = await page.evaluate(() => document.querySelector('#version-heading').getBoundingClientRect().top - document.querySelector('.settings-body').getBoundingClientRect().top);
    assert.ok(gap < 30, `the version heading starts the page (${gap} px)`);
    await page.screenshot({ path: `build/handheld-probe-${platform}-${locale}.png` });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: 'build/handheld-probe-failure.png' }).catch(() => {});
    if (failure) console.error(failure);
    throw error;
  } finally {
    await browser.close(); host.stdin.end(); await exit;
    await rm(directory, { recursive: true, force: true });
  }
}

await phone('android', 'en-US');
await phone('ios', 'zh-TW');
console.log('PASS handheld-probe: phones show their version under General, with no update row or startup settings, and do not zoom.');
