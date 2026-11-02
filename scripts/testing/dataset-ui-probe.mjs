/** Dataset UI regression in an isolated browser. Usage: node scripts/testing/dataset-ui-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { openBackup } from '../../src/backup/payload.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/dataset-ui-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit]\nUses isolated synthetic local profiles. No Google account or existing browser data is touched.');
  process.exit(0);
}
const value = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--url'), '--url is required');
const base = new URL(value('--url')), engine = process.argv.includes('--browser') ? value('--browser') : 'chromium';
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname)); assert.ok(['chromium', 'webkit'].includes(engine));
const browser = await ({ chromium, webkit })[engine].launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'en-US', acceptDownloads: true });
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const profileId = `dataset-ui-${crypto.randomUUID()}`;
const url = new URL('/app/index.html', base); url.searchParams.set('profile', profileId);
const settings = async name => {
  await page.locator('#settings-button').click(); await page.locator(`#settings-dialog [data-page="${name}"]`).click();
};
const read = () => page.evaluate(async profile => {
  const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
  const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
  const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { return await storage.load(profile); }
      catch (error) { if (error.code !== 'stale-writer' || attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
    }
  } finally { storage.close(); }
}, profileId);
try {
  await page.goto(new URL('/app/style.css', base).href);
  await page.evaluate(async profile => {
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { Workspace } = await import('/core/workspace.js');
    const storage = await IndexedDbStorage.open();
    const old = await Workspace.create({ profileId: profile, deviceId: 'old-device', area: { x: 0, y: 0, width: 1200, height: 900 },
      persist: (...args) => storage.save(...args) });
    await old.createCard({ format: 'markdown', text: 'old-format data must stay until consent', attachments: [] }); storage.close();
  }, profileId);
  await page.goto(url.href); await expect(page.locator('#data-failure-dialog')).toBeVisible();
  await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
  await expect(page.locator('#settings-page-title')).toHaveText(t('settings.data.title'));
  await expect(page.locator('#discard-old-local')).toBeDisabled(); await page.reload();
  await expect(page.locator('#data-failure-dialog')).toContainText(t('app.incompatible.keep'));
  await page.getByRole('button', { name: t('app.incompatible.openSettings'), exact: true }).click();
  await page.locator('#discard-old-local-agree').check(); await page.locator('#discard-old-local').click();
  await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  assert.equal((await read()).format, 'work-fleet-workspace-current');
  await page.goto(new URL('/app/style.css', base).href);
  const seeded = await page.evaluate(async profile => {
    const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
    const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
    const { Workspace } = await import('/core/workspace.js');
    const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
    const workspace = new Workspace(await storage.load(profile), (...args) => storage.save(...args), undefined, undefined, { history: storage });
    const content = text => ({ format: 'markdown', text, attachments: [] });
    let note = await workspace.createCard(content('first version'));
    const first = note.revision;
    for (let i = 0; i < 27; i++) note = await workspace.updateCard(note.id, { content: content(`version ${i}`) }, note.revision);
    note = await workspace.updateCard(note.id, { deleted: true }, note.revision);
    let second = await workspace.createCard(content('second trashed note'));
    second = await workspace.updateCard(second.id, { deleted: true }, second.revision);
    const neighbor = await workspace.createCard(content('keep this neighbor'));
    storage.close(); return { note: note.id, first, second: second.id, neighbor: neighbor.id };
  }, profileId);
  await page.goto(url.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  await settings('revisions'); await page.getByRole('button', { name: t('conflicts.tab.history'), exact: true }).click();
  await page.locator('#revision-panel .field select').selectOption({ label: t('conflicts.history.note', { summary: 'version 26' }) });
  await expect(page.locator('#revision-panel [data-revision-id]')).toHaveCount(20);
  await page.getByRole('button', { name: t('conflicts.history.more'), exact: true }).click();
  await expect(page.locator('#revision-panel [data-revision-id]')).toHaveCount(29);
  await page.locator(`[data-revision-id="${seeded.first}"]`).getByRole('button', { name: t('conflicts.version.restore'), exact: true }).click();
  await expect.poll(async () => (await read()).cards.find(card => card.id === seeded.note)?.content.text).toBe('first version');
  await page.locator('#close-settings').click(); await page.locator('[data-filter="deleted"]').click();
  await page.locator('#empty-trash').click(); await expect(page.locator('#purge-dialog')).toContainText('second trashed note');
  await page.locator('#purge-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  assert.ok((await read()).cards.some(card => card.id === seeded.second));
  await page.locator('#empty-trash').click(); await page.locator('#confirm-purge').click();
  await expect(page.locator('#cleanup-status')).toHaveText(t('app.purge.complete'), { timeout: 15000 });
  const after = await read(); assert.equal(after.cards.some(card => card.id === seeded.second), false);
  assert.ok(after.cards.some(card => card.id === seeded.neighbor));
  await settings('data'); await expect(page.locator('#backup-coverage')).toHaveValue('complete-retained-history');
  await page.locator('#backup-coverage').selectOption('current-state-only'); await page.locator('#backup-encrypt').uncheck();
  const download = page.waitForEvent('download'); await page.locator('#export-backup').click();
  const backup = await openBackup(new Uint8Array(await readFile(await (await download).path())), { requireCurrent: true });
  assert.equal(backup.manifest.coverage.mode, 'current-state-only'); assert.equal(backup.manifest.counts.revisions, 3);
  await page.locator('#close-settings').click(); await page.goto(new URL('/app/style.css', base).href);
  const deleted = await page.evaluate(async profile => {
    const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
    const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
    const { Workspace } = await import('/core/workspace.js');
    const { DatasetPurge } = await import('/sources/dataset-purge.js');
    const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
    const workspace = new Workspace(await storage.load(profile), (...args) => storage.save(...args), undefined, undefined, { history: storage });
    let card = workspace.snapshot.cards[0];
    const draft = workspace.blankDraft(card.groupId, card); draft.content.text = 'unpublished recovery content'; await workspace.saveDraft(draft);
    card = await workspace.updateCard(card.id, { deleted: true }, card.revision);
    const purge = new DatasetPurge({ workspace, storage }); await purge.enqueue(await purge.preview([card.id]));
    while (await purge.step()) { /* Finish synthetic local cleanup before opening the UI. */ }
    storage.close(); return card.id;
  }, profileId);
  await page.goto(url.href); await page.locator('[data-view="board"]').click();
  await expect(page.locator(`#list [data-card-id="${deleted}"]`)).toHaveCount(0);
  await page.locator('#conflicts-button').click(); await expect(page.locator('[data-recovery-draft]')).toHaveCount(1);
  await page.locator('[data-recovery-draft]').getByRole('button', { name: t('app.editor.saveCopy'), exact: true }).click();
  const recovered = (await read()).cards.find(card => card.content.text === 'unpublished recovery content');
  assert.ok(recovered && recovered.id !== deleted); await page.locator('#close-settings').click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-filter="deleted"]').click();
  const trashVisible = await page.locator('[data-filter=deleted]').evaluate(element => {
    const button = element.getBoundingClientRect(), strip = element.parentElement.getBoundingClientRect();
    return button.left >= strip.left && button.right <= strip.right;
  });
  assert.equal(trashVisible, true, 'the selected Trash filter must remain visible beside its actions on mobile');
  await mkdir('build/dataset-ui', { recursive: true }); await page.screenshot({ path: `build/dataset-ui/${engine}-trash.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile layout overflows');
  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: incompatible local consent, bounded history pages/restore, Trash cancel/purge, current-only export, new-identity draft recovery and mobile layout.`);
} finally { await context.close(); await browser.close(); }
