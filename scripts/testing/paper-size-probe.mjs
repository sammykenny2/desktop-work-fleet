/** Real-browser desktop note sizes. Usage: node scripts/testing/paper-size-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW] */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { setLocale, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/paper-size-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW]\nChecks size preferences, placements, unchanged board geometry and restart persistence with synthetic notes in an isolated profile. Pictures go to build/paper-size-probe.');
  process.exit(0);
}
const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const url = new URL(arg('--url'));
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Only loopback development previews are allowed');
url.pathname = '/app/index.html'; const profile = `paper-size-${crypto.randomUUID()}`; url.searchParams.set('profile', profile);
const engine = arg('--browser', 'chromium'); assert.ok(['chromium', 'webkit'].includes(engine));
const locale = arg('--locale', 'en'); assert.ok(['en', 'zh-TW'].includes(locale)); setLocale(locale);
const browser = await ({ chromium, webkit })[engine].launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale });
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
const opened = () => expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
const settings = async () => { await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click(); };
const read = () => page.evaluate(async profile => {
  const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
  const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
  const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
  try {
    // A read-only inspection can overlap the UI's save; reload a coherent snapshot without retrying any writes.
    for (let attempt = 0; ; attempt++) {
      try { return { state: await storage.load(profile), desk: await storage.getControl('desk') }; }
      catch (error) { if (error.code !== 'stale-writer' || attempt === 4) throw error; }
    }
  }
  finally { storage.close(); }
}, profile);
const capture = async text => {
  if (await page.locator('.first-note').count()) await page.locator('.first-note button').click();
  else { await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); }
  await page.locator('#editor-text').fill(text); await page.locator('#editor-form button[type=submit]').click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
try {
  await page.goto(url.href); await opened(); await capture('Medium note');
  await settings(); await expect(page.locator('#desktop-paper-size')).toHaveValue('medium');
  await expect(page.locator('#desktop-paper-size option')).toHaveText([
    t('settings.desktop.paperSizeSmall'), t('settings.desktop.paperSizeMedium'),
    t('settings.desktop.paperSizeLarge'), t('settings.desktop.paperSizeTall'),
  ]);
  // A single roomy region makes the preset dimensions observable without the fitting fallback.
  await page.locator('#grid-rows').selectOption('1'); await page.locator('#grid-columns').selectOption('1');
  const before = await read(); const oldPositions = before.state.layout.placements;
  for (const [name, width, height] of [['small', 160, 160], ['medium', 240, 240], ['large', 320, 320], ['tall', 320, 480]]) {
    await page.locator('#desktop-paper-size').selectOption(name);
    await expect.poll(async () => (await read()).desk.newPaperSize).toBe(name);
    assert.deepEqual((await read()).state.layout.placements, oldPositions, 'changing a preference moves no existing paper');
    await page.locator('#close-settings').click(); await capture(`${name} note`);
    const saved = await read(); const note = saved.state.cards.find(card => card.content.text === `${name} note`);
    const placed = saved.state.layout.placements[note.id];
    assert.deepEqual([placed.width, placed.height], [width, height]);
    const board = await page.locator('.board .note-paper').last().boundingBox();
    assert.deepEqual([board.width, board.height], [240, 240], 'the main-window board is independent');
    Object.assign(oldPositions, saved.state.layout.placements);
    // Both persisted selection and untouched geometry are observed after a full renderer restart.
    await page.reload(); await opened(); await settings(); await expect(page.locator('#desktop-paper-size')).toHaveValue(name);
    assert.deepEqual((await read()).state.layout.placements, oldPositions);
  }
  await page.locator('#desktop-paper-size').selectOption('tall');
  await expect.poll(async () => (await read()).desk.newPaperSize).toBe('tall');
  await mkdir('build/paper-size-probe', { recursive: true });
  await page.screenshot({ path: `build/paper-size-probe/${engine}-${locale}-settings.png` });
  for (const width of [700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#desktop-paper-size').scrollIntoViewIfNeeded();
    const fit = await page.locator('#desktop-paper-size').evaluate(node => {
      const box = node.getBoundingClientRect(); const body = node.closest('.settings-body');
      const bounds = body.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right && body.scrollWidth <= body.clientWidth;
    });
    assert.ok(fit, `the size selector fits Settings at ${width} px`);
    await expect(page.locator('#desktop-paper-size')).toHaveValue('tall');
    await page.screenshot({ path: `build/paper-size-probe/${engine}-${locale}-settings-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('#close-settings').click(); await page.locator('[data-view="desktop"]').click();
  const tall = await read(); const tallId = tall.state.cards.find(card => card.content.text === 'tall note').id;
  const paper = await page.locator(`#stage .card[data-card-id="${tallId}"]`).boundingBox();
  assert.deepEqual([paper.width, paper.height], [320, 480], 'the desktop draws the actual tall geometry');
  await page.screenshot({ path: `build/paper-size-probe/${engine}-${locale}-desktop.png` });
  assert.deepEqual(errors, []);
  console.log(`PASS: ${engine} ${locale}: clean-install Medium, four sizes, saved selection, unchanged existing notes and board, and Tall desktop geometry`);
} finally { await context.close(); await browser.close(); }
