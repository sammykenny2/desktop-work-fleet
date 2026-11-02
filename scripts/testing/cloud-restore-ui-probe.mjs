/** Isolated Google-overwrite UI/IndexedDB regression. Usage: node scripts/testing/cloud-restore-ui-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/cloud-restore-ui-probe.mjs --url http://127.0.0.1:PORT\nUses isolated IndexedDB, OPFS and a synthetic FileStore. No Google account or personal files.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback previews are allowed');
const fixture = (await readFile(new URL('../../tests/fixtures/dataset/provider.js', import.meta.url), 'utf8')).replaceAll('../../../src/', '/');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ locale: 'en-US' });
await context.route('**/fixtures/file-store.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
// Keep the real document/styles, but mount only the panel under test rather than a competing app owner.
await context.route('**/app/main.js', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL('/app/index.html', base); url.searchParams.set('profile', `cloud-ui-${crypto.randomUUID()}`);
  await page.goto(url.href);
  const bytes = await page.evaluate(async () => {
    const { Workspace } = await import('/core/workspace.js');
    const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
    const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
    const { createBackup } = await import('/backup/payload.js');
    const { prepareDatasetRestore, resumeDatasetRestore } = await import('/backup/dataset-restore.js');
    const { DatasetReset } = await import('/sources/dataset-reset.js');
    const { backupPanel } = await import('/app/backup.js');
    const { DatasetSync } = await import('/sources/dataset-sync.js');
    const { DatasetTestProvider } = await import('/fixtures/file-store.js');
    const records = await IndexedDbRecordStore.open(`cloud-ui-${crypto.randomUUID()}`);
    const storage = new WorkspaceRecordStorage(records, 'google:fixture'), localStorage = new WorkspaceRecordStorage(records, 'local');
    const area = { x: 0, y: 0, width: 1400, height: 900 };
    const create = profileId => { const target = profileId === 'local' ? localStorage : storage; return Workspace.create({ profileId, current: true, history: target, deviceId: crypto.randomUUID(), area, persist: (...args) => target.save(...args) }); };
    const local = await create('local'); const localGroup = local.snapshot.groups[0];
    await local.createCard({ format: 'markdown', text: 'restored backup content' }, localGroup.id);
    const draft = local.blankDraft(localGroup.id); draft.content.text = 'backup draft stays unpublished'; await local.saveDraft(draft);
    const backup = await createBackup({ workspace: local, storage: localStorage });
    const workspace = await create('google:fixture'); const store = new DatasetTestProvider();
    await workspace.createCard({ format: 'markdown', text: 'old data before clearing' }, workspace.snapshot.groups[0].id);
    const sync = new DatasetSync({ workspace, storage, fileStore: store }); await sync.sync(); await sync.stop({ endSession: false });
    const oldIds = [...store.files.values()].filter(item => !['folder', 'dataset-root'].includes(item.file.kind)).map(item => item.file.id);
    const root = await navigator.storage.getDirectory();
    let filesSaved = 0;
    const files = { canConfirmSave: true, chooseDestination: async () => ({ save: async ({ bytes }) => {
      const handle = await root.getFileHandle(`safety-${++filesSaved}.zip`, { create: true });
      const writable = await handle.createWritable(); await writable.write(bytes); await writable.close();
      const read = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (read.length !== bytes.length || read.some((value, i) => value !== bytes[i])) throw new Error('OPFS readback mismatch');
      return { saved: true, receipt: 'opfs-verified' };
    } }) };
    const panel = backupPanel({ workspace, storage, files, getWorkAreas: () => [area], flush: async () => {}, onChanged: async () => {},
      cloudRestore: { target: 'synthetic-account@example.invalid',
        prepare: options => prepareDatasetRestore({ ...options, workspace, storage, fileStore: store }),
        run: async (plan, safetyBackup, say) => {
          await plan.stage(workspace, storage, store, safetyBackup);
          const state = await resumeDatasetRestore({ state: await storage.load(workspace.state.profileId), storage, fileStore: store });
          const reset = new DatasetReset(store, storage);
          while ((await reset.status()).phase !== 'complete') await reset.step();
          window.probeResult = { text: state.cards.map(card => card.content.text), drafts: Object.values(state.drafts).map(draft => draft.content.text),
            oldFilesGone: oldIds.every(id => !store.files.has(id)), pending: Boolean(state.cloudRestore), filesSaved };
          say('synthetic overwrite finished');
        } } });
    document.body.replaceChildren(panel.element); window.probePanel = panel;
    window.probeCalls = () => Object.values(store.stats).reduce((a, b) => a + b, 0);
    return Array.from(backup.bytes);
  });
  const choose = async buffer => page.locator('#restore-file').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer });
  await page.locator('#restore-mode').selectOption('cloud-replace');
  await expect(page.getByText(/synthetic-account@example.invalid/)).toBeVisible();
  await choose(Buffer.from('invalid')); const calls = await page.evaluate(() => window.probeCalls());
  await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toHaveClass(/error/);
  assert.equal(await page.evaluate(() => window.probeCalls()), calls);
  await choose(Buffer.from(bytes)); await page.locator('#backup-encrypt').uncheck(); await page.locator('#backup-coverage').selectOption('current-state-only');
  const preview = async () => { await page.locator('#preview-restore').click(); await expect(page.locator('#backup-status')).toHaveText(t('backup.restore.ready')); };
  await preview(); assert.equal(await page.evaluate(() => window.probePanel.blocksSync()), true);
  await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#restore-cloud-agree').check(); await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#save-safety-backup').click(); await expect(page.locator('#confirm-restore')).toBeEnabled();
  await choose(Buffer.from(bytes)); await expect(page.locator('#restore-cloud-agree')).not.toBeChecked();
  await expect(page.locator('#confirm-restore')).toBeDisabled();
  await preview(); await page.locator('#save-safety-backup').click(); await expect(page.locator('#confirm-restore')).toBeDisabled();
  await page.locator('#restore-cloud-agree').check(); await expect(page.locator('#confirm-restore')).toBeEnabled();
  await page.locator('#confirm-restore').click(); await expect(page.locator('#backup-status')).toHaveText('synthetic overwrite finished');
  const result = await page.evaluate(() => window.probeResult);
  assert.deepEqual(result, { text: ['restored backup content'], drafts: ['backup draft stays unpublished'], oldFilesGone: true, pending: false, filesSaved: 2 });
  assert.deepEqual(errors, []);
  console.log('PASS cloud overwrite UI: verified safety save plus explicit consent, changed-file invalidation, paused preview sync, real IndexedDB restore and synthetic remote replacement');
} finally { await context.close(); await browser.close(); }
