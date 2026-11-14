/** Production UI gestures and IndexedDB persistence. Usage: node scripts/testing/stacking-probe.mjs --url URL [--browser chromium|webkit] */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/stacking-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit]\nChecks overlap, selection, drag/cancel, Undo and reload through the real UI with isolated synthetic notes. Pictures go to build/stacking-checks.');
  process.exit(0);
}
const arg = (key, fallback) => { const index = process.argv.indexOf(key); return index < 0 ? fallback : process.argv[index + 1]; };
const url = new URL(arg('--url')), engine = arg('--browser', 'chromium');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.ok(['chromium', 'webkit'].includes(engine));
const profile = `stacking-${crypto.randomUUID()}`; url.pathname = '/app/index.html'; url.searchParams.set('profile', profile);
const browser = await ({ chromium, webkit })[engine].launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'en' });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const ready = () => expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
const read = () => page.evaluate(async profile => {
  const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
  const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
  const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await storage.load(profile); } catch (error) { if (error.code !== 'stale-writer' || attempt === 4) throw error; }
    }
  } finally { storage.close(); }
}, profile);
const paper = id => page.locator(`#stage .card[data-card-id="${id}"]`);
const box = async id => { const rect = await paper(id).boundingBox(); assert.ok(rect); return rect; };
const front = () => page.locator('#stage .card').evaluateAll(nodes => [...nodes].sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex)).at(-1)?.dataset.cardId);
try {
  await page.goto(url.href); await ready();
  for (const text of ['Alpha paper', 'Beta paper', 'Gamma paper']) {
    if (await page.locator('.first-note').count()) await page.locator('.first-note button').click(); else await page.locator('#compose').click();
    await page.locator('#editor-text').fill(text); await page.locator('#editor-form button[type=submit]').click();
    await expect(page.locator('#editor-dialog')).not.toBeVisible();
  }
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await page.locator('#grid-rows').selectOption('1'); await page.locator('#grid-columns').selectOption('1');
  await page.locator('#close-settings').click();
  const original = await read(), byText = text => original.cards.find(card => card.content.text === text).id;
  const a = byText('Alpha paper'), b = byText('Beta paper'), c = byText('Gamma paper');
  await page.locator('#operate-all').click(); await expect(paper(a)).toHaveClass(/operable/);
  const from = await box(a), target = await box(c);
  await page.mouse.move(from.x + 40, from.y + 14); await page.mouse.down();
  await page.mouse.move(target.x + 100, target.y + 64, { steps: 8 }); await page.mouse.up();
  await expect.poll(front).toBe(a);
  await expect.poll(async () => (await read()).layout.placements[a].zOrder).not.toBe(original.layout.placements[a].zOrder);
  // Gamma's title remains exposed above the dragged Alpha paper. Hit testing must select Gamma, then keep it in front.
  const gamma = await box(c); await page.mouse.click(gamma.x + 40, gamma.y + 14);
  await expect.poll(front).toBe(c);
  await page.locator('#undo').click();
  await expect.poll(async () => (await read()).layout.placements[a].x).toBe(original.layout.placements[a].x);
  await expect.poll(front).toBe(c);
  const beforeCancel = await read(), beta = await box(b);
  await page.mouse.move(beta.x + 40, beta.y + 14); await page.mouse.down(); await page.mouse.move(beta.x + 90, beta.y + 90, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => (await read()).layout.placements).toEqual(beforeCancel.layout.placements);
  await expect.poll(front).toBe(c);
  const visited = [];
  // Refuse exactly the profile's layout write after its reservation; the visible drag must roll back too.
  await page.evaluate(async () => {
    const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
    const commit = IndexedDbRecordStore.prototype.commit; window.probeLayoutFailure = false;
    IndexedDbRecordStore.prototype.commit = function(transaction, ...args) {
      if (!window.probeLayoutFailure && transaction.puts.some(row => row.collection === 'meta' && row.key.endsWith(':layout'))) {
        window.probeLayoutFailure = true; return Promise.reject(new Error('Synthetic layout save failure'));
      }
      return commit.call(this, transaction, ...args);
    };
  });
  const oldAlpha = await box(a), beforeFailure = (await read()).layout.placements;
  await page.mouse.move(oldAlpha.x + 40, oldAlpha.y + 14); await page.mouse.down();
  await page.mouse.move(oldAlpha.x + 100, oldAlpha.y + 80, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.probeLayoutFailure)).toBe(true);
  await expect.poll(async () => (await read()).layout.placements).toEqual(beforeFailure);
  await expect.poll(async () => (await box(a)).x).toBe(oldAlpha.x);
  await expect.poll(front).toBe(c);
  for (let i = 0; i < 3; i++) {
    await page.locator('#cycle-next').click();
    await expect.poll(async () => page.locator('#stage .card.selected').count()).toBe(1);
    await expect.poll(async () => (await read()).layout.revision).toBeGreaterThan(i ? visited.at(-1).revision : beforeCancel.layout.revision);
    visited.push({ id: await page.locator('#stage .card.selected').getAttribute('data-card-id'), revision: (await read()).layout.revision });
  }
  assert.equal(new Set(visited.map(value => value.id)).size, 3);
  const last = visited.at(-1).id;
  await mkdir('build/stacking-checks', { recursive: true });
  await page.screenshot({ path: `build/stacking-checks/${engine}-adjust.png` });
  await page.locator('#stop-operation').click(); await expect(page.locator('#adjust-bar')).not.toBeVisible();
  assert.equal(await front(), last);
  const saved = (await read()).layout.placements;
  await page.reload(); await ready(); await page.locator('[data-view="desktop"]').click();
  await expect.poll(front).toBe(last); assert.deepEqual((await read()).layout.placements, saved);
  await expect(page.locator('#stage .card.selected')).toHaveCount(0);
  await page.screenshot({ path: `build/stacking-checks/${engine}-reopened.png` });
  assert.deepEqual(errors, []); console.log(`PASS ${engine}: production drag, hit testing, cancel, conditional Undo, cycle and persisted order after reload`);
} finally { await browser.close(); }
