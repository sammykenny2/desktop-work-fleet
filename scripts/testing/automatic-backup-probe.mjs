/** Real IDB scheduler/UI probe with an explicitly synthetic file host. Usage: node scripts/testing/automatic-backup-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/automatic-backup-probe.mjs --url http://127.0.0.1:PORT\nVerifies real IndexedDB journals and UI using synthetic atomic files. Browser automatic filesystem access stays unavailable.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  const app = new URL('/app/index.html', base); app.searchParams.set('profile', crypto.randomUUID());
  await page.goto(app.href); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await page.locator('#account-button').click(); await page.locator('#backup-button').click();
  await expect(page.locator('#auto-backup-retention')).toContainText('不支援自動備份');
  for (const id of ['location', 'enable', 'now', 'keep']) await expect(page.locator(`#auto-backup-${id}`)).toBeDisabled();
  await expect(page.locator('#export-backup')).toBeEnabled();
  await page.goto(new URL('/app/style.css', base).href);
  await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports: { fflate: '/vendor/fflate.js' } }) });
  await page.addStyleTag({ url: new URL('/app/style.css', base).href });
  await page.evaluate(async () => {
    const { Workspace } = await import('/core/workspace.js');
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { IndexedDbBackupJournal } = await import('/backup/browser-automatic.js');
    const { AutomaticBackup } = await import('/backup/automatic.js');
    const { automaticBackupSection } = await import('/app/automatic-backup.js');
    const { sha256 } = await import('/sources/files.js');
    const { FleetError } = await import('/core/contracts.js');
    const storage = await IndexedDbStorage.open(); const journal = await IndexedDbBackupJournal.open(); const profileId = crypto.randomUUID();
    const workspace = await Workspace.create({ profileId, deviceId: crypto.randomUUID(), area: { x: 0, y: 0, width: 1200, height: 800 },
      persist: (value, revision) => storage.save(value, revision) });
    await workspace.createCard({ format: 'markdown', text: 'automatic 中文💡', attachments: [] });
    const fixture = { profileId, storage, journal, workspace, count: 0, lose: false, permitted: true, entries: new Map(), flush: async () => {} };
    const key = job => `${job.destinationId}/${job.name}`;
    const files = {
      available: true, canCreate: true, canPrune: true,
      chooseDestination: async () => ({ destinationId: 'synthetic-files', destinationName: 'Synthetic test files' }), authorize: async () => {},
      read: async job => fixture.entries.get(key(job))?.slice() ?? null,
      create: async job => {
        if (!fixture.permitted) throw new FleetError('backup-permission', 'Synthetic permission revoked');
        if (fixture.entries.has(key(job))) throw new Error('synthetic create-only collision');
        // One synchronous map insertion is the test host's atomic primitive. No OS file semantics are claimed.
        fixture.entries.set(key(job), job.bytes.slice()); fixture.count++;
        if (fixture.lose) { fixture.lose = false; throw new Error('lost file acknowledgement'); }
        return { saved: true, receipt: crypto.randomUUID() };
      },
      remove: async job => {
        const expected = fixture.entries.get(key(job));
        if (expected && await sha256(expected) !== job.sha256) throw new Error('synthetic file changed');
        if (fixture.entries.get(key(job)) !== expected) throw new Error('synthetic identity changed');
        fixture.entries.delete(key(job)); return { removed: true };
      },
    };
    fixture.make = () => new AutomaticBackup({ workspace, storage, journal, files, flush: () => fixture.flush() });
    fixture.service = fixture.make(); await fixture.service.load();
    const section = automaticBackupSection({ service: fixture.service, files }); fixture.section = section;
    document.body.replaceChildren(section.element); section.element.style.width = 'min(600px, calc(100vw - 32px))'; section.element.style.margin = '16px';
    window.autoProbe = fixture;
  });
  await page.locator('#auto-backup-location').click(); await page.locator('#auto-backup-enable').click();
  await expect(page.locator('#auto-backup-message')).toContainText('沒有安全密碼儲存');
  assert.equal(await page.evaluate(() => window.autoProbe.journal.load(window.autoProbe.profileId)), null);
  await page.locator('#auto-backup-encrypt').uncheck(); await page.locator('#auto-backup-keep').fill('1');
  await page.locator('#auto-backup-enable').click(); await expect(page.locator('#auto-backup-message')).toContainText('已保存並校驗');
  await page.locator('#auto-backup-now').click(); await expect(page.locator('#auto-backup-message')).toContainText('已保存並校驗');
  assert.deepEqual(await page.evaluate(() => ({ count: window.autoProbe.count, inventory: window.autoProbe.service.state.inventory.length })), { count: 2, inventory: 1 });
  await page.evaluate(() => {
    window.autoProbe.flush = () => new Promise(resolve => { window.autoProbe.gateEntered = true; window.autoProbe.release = resolve; });
  });
  await page.locator('#auto-backup-now').click(); await page.waitForFunction(() => window.autoProbe.gateEntered);
  await expect(page.locator('#auto-backup-disable')).toBeEnabled(); await page.locator('#auto-backup-disable').click();
  await page.evaluate(() => window.autoProbe.release()); await expect(page.locator('#auto-backup-status')).toContainText('已停用');
  assert.equal(await page.evaluate(() => window.autoProbe.count), 2, 'stopped preparation created no new output');
  await page.evaluate(() => { window.autoProbe.flush = async () => {}; });
  await page.locator('#auto-backup-enable').click(); await expect(page.locator('#auto-backup-message')).toContainText('已保存並校驗');
  const result = await page.evaluate(async () => {
    const f = window.autoProbe; const assert = (value, message) => { if (!value) throw new Error(message); };
    f.lose = true;
    try { await f.service.run({ force: true }); throw new Error('lost response accepted'); }
    catch (error) { assert(error.message === 'lost file acknowledgement', 'file response loss'); }
    const pending = (await f.journal.load(f.profileId)).pending; const count = f.count;
    const restarted = f.make(); assert((await restarted.run({ force: true })).kind === 'recovered', 'durable job recovery');
    assert(f.count === count && restarted.state.lastSuccess.id === pending.id && restarted.state.inventory.length === 1, 'no repeated output');
    const originalPut = IDBObjectStore.prototype.put; let aborted = false;
    IDBObjectStore.prototype.put = function(value, ...args) {
      const request = originalPut.call(this, value, ...args);
      if (!aborted && this.name === 'journals' && value.profileId === f.profileId && value.pending) { aborted = true; this.transaction.abort(); }
      return request;
    };
    try { await restarted.run({ force: true }); throw new Error('journal abort accepted'); }
    catch (error) { assert(error.code === 'backup-journal-aborted', 'journal reservation abort'); }
    finally { IDBObjectStore.prototype.put = originalPut; }
    assert(f.count === count, 'aborted reservation published no file');
    f.permitted = false;
    try { await restarted.run({ force: true }); throw new Error('missing permission accepted'); }
    catch (error) { assert(error.code === 'backup-permission', 'permission pause'); }
    assert(restarted.state.paused && (await restarted.run()).kind === 'paused', 'pause is durable');
    const current = await f.journal.load(f.profileId);
    try { await f.journal.save({ ...current, revision: current.revision + 1 }, current.revision - 1); throw new Error('stale journal accepted'); }
    catch (error) { assert(error.code === 'stale-backup-writer', 'journal CAS'); }
    const { openBackup } = await import('/backup/payload.js');
    const latest = current.lastSuccess; const file = f.entries.get(`${latest.destinationId}/${latest.name}`);
    assert((await openBackup(file)).data.records.some(record => record.value.content?.text === 'automatic 中文💡'), 'portable bytes contain real Workspace records');
    f.section.dispose(); return { reservationAbort: true, lostFileAcknowledgement: true, permissionPause: true, journalCas: true, stopDuringUiRun: true };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('#automatic-backup').evaluate(section => section.scrollWidth <= section.clientWidth + 1), 'narrow controls fit');
  await page.screenshot({ path: 'build/automatic-backup-probe.png' }); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ...result, syntheticFileHost: true, realIndexedDb: true, browserAutomaticFilesUnavailable: true }));
} catch (error) { await page.screenshot({ path: 'build/automatic-backup-probe-failure.png' }); throw error; }
finally { await context.close(); await browser.close(); }
