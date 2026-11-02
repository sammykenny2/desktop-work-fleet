// Real IndexedDB transactions in an isolated browser origin; no server, Google account or existing browser profile.
// Usage: node tests/record-storage.browser.mjs [chromium|webkit]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const name = process.argv[2] ?? 'chromium';
assert.ok(['chromium', 'webkit'].includes(name));
const bundle = await build({ stdin: { contents: `
  import { IndexedDbRecordStore } from './src/storage/records-indexed-db.js';
  import { recordTransaction } from './src/storage/records.js';
  import { sha256 } from './src/sources/files.js';
  import { Workspace } from './src/core/workspace.js';
  import { WorkspaceRecordStorage } from './src/storage/workspace-records.js';
  import { createBackup, openBackup } from './src/backup/payload.js';
  import { prepareLocalRestore } from './src/backup/restore.js';
  window.recordProbe = { IndexedDbRecordStore, recordTransaction, sha256, Workspace, WorkspaceRecordStorage,
    createBackup, openBackup, prepareLocalRestore };`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife' });
const browser = await ({ chromium, webkit })[name].launch();
let phase = 'create isolated context';
const deadline = setTimeout(() => { console.error(`${name}: timed out during ${phase}`); void browser.close(); }, 60_000);
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated record store</title>' }));
  const page = await context.newPage();
  await page.exposeFunction('recordPhase', value => { phase = value; if (process.env.RECORD_PROBE_TRACE) console.log(`${name}: ${phase}`); });
  phase = 'navigate to intercepted origin'; await page.goto('https://record-store.invalid');
  phase = 'load test bundle';
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { IndexedDbRecordStore, recordTransaction, sha256, Workspace, WorkspaceRecordStorage,
      createBackup, openBackup, prepareLocalRestore } = window.recordProbe;
    const check = (value, message) => { if (!value) throw new Error(message); };
    const row = (collection, key, ordinal, text = key) => ({ collection, key, entity: 'card:one', ordinal, value: { text } });
    const name = `records-${crypto.randomUUID()}`;
    await window.recordPhase('open database');
    let store = await IndexedDbRecordStore.open(name, { legacyName: null });
    const first = recordTransaction('local', null, [row('history', 'r0', 0), row('current', 'one', 0)]);
    const bytes = new TextEncoder().encode('atomic attachment'); const id = await sha256(bytes);
    const receipt = await store.commit(first, null);
    check((await store.commit(first, null)).commitId === receipt.commitId, 'replay failed');
    await window.recordPhase('competing writer connections');
    const rival = await IndexedDbRecordStore.open(name, { legacyName: null });
    const results = await Promise.allSettled([store.commit(recordTransaction('local', 0, [row('draft', 'one', 1)]), 0),
      rival.commit(recordTransaction('local', 0, [row('draft', 'one', 1)]), 0)]);
    check(results.filter(value => value.status === 'fulfilled').length === 1
      && results.find(value => value.status === 'rejected').reason.code === 'stale-writer', 'concurrent writers both committed');
    rival.close();
    await window.recordPhase('rollback rows and attachments');
    try {
      await store.commit(recordTransaction('local', 1, [row('current', 'one', 2, 'must roll back'), row('history', 'r0', 2, 'collision')]), 1, { attachments: [{ id, bytes }] });
      throw new Error('collision accepted');
    } catch (error) { check(error.code === 'revision-collision', error.message); }
    await window.recordPhase('read after rollback');
    check((await store.get('local', 'current', 'one')).value.text === 'one', 'rollback failed');
    check(await store.getAttachment('local', id) === null, 'attachment committed after rollback');
    check((await store.status('local')).revision === 1, 'receipt committed after rollback');
    await window.recordPhase('commit and read attachment');
    await store.commit(recordTransaction('local', 1, [row('history', 'r1', 2), row('history', 'r2', 2)]), 1, { attachments: [{ id, bytes }] });
    await window.recordPhase('read committed attachment');
    check(await (await store.getAttachment('local', id)).text() === 'atomic attachment', 'attachment commit failed');
    check(await store.getAttachment('google:other', id) === null, 'attachment crossed profiles');
    const query = { collection: 'history', entity: 'card:one', limit: 1, expectedRevision: 2 };
    const a = await store.page('local', query), b = await store.page('local', { ...query, after: a.next });
    check(a.rows[0].key === 'r2' && b.rows[0].key === 'r1', 'page ordering failed');
    const earliest = await store.page('local', { ...query, order: 'asc' });
    const following = await store.page('local', { ...query, order: 'asc', after: earliest.next });
    check(earliest.rows[0].key === 'r0' && following.rows[0].key === 'r1', 'ascending pending order failed');
    const keys = await store.page('local', { ...query, keysOnly: true });
    check(JSON.stringify(Object.keys(keys.rows[0]).sort()) === JSON.stringify(['collection', 'key', 'ordinal']), 'metadata page read values');
    await window.recordPhase('reopen and byte-bounded pages');
    check(await store.get('google:other', 'history', 'r0') === null, 'account leak');
    store.close(); store = await IndexedDbRecordStore.open(name, { legacyName: null });
    check((await store.status('local')).revision === 2, 'reopen lost data');
    for (let i = 0; i < 3; i++) await store.commit(recordTransaction('local', i + 2, [row('history', `large${i}`, i + 3, 'x'.repeat(3 * 1024 * 1024))]), i + 2);
    const large = await store.page('local', { collection: 'history', expectedRevision: 5 });
    check(large.rows.length === 2 && new TextEncoder().encode(JSON.stringify(large)).length <= 8 * 1024 * 1024, 'page byte bound failed');
    const remove = recordTransaction('local', 5, [], [], undefined, [id]);
    await store.commit(remove, 5); check(await store.getAttachment('local', id) === null, 'attachment deletion failed');
    await store.commit(remove, 5, { attachments: [{ id, bytes }] });
    check(await store.getAttachment('local', id) === null, 'replayed deletion applied extra upload bytes');
    await store.reset('local'); check(await store.status('local') === null && await store.getAttachment('local', id) === null, 'reset retained data'); store.close();
    await window.recordPhase('current Workspace persistence and reopen');
    const currentStore = await IndexedDbRecordStore.open(`current-${crypto.randomUUID()}`, { legacyName: null });
    const storage = new WorkspaceRecordStorage(currentStore, 'local');
    const workspace = await Workspace.create({ profileId: 'local', deviceId: 'device', area: { x: 0, y: 0, width: 1200, height: 900 },
      persist: (...args) => storage.save(...args), current: true, history: storage });
    let card = await workspace.createCard({ text: 'original', format: 'markdown' });
    for (let i = 0; i < 25; i++) card = await workspace.updateCard(card.id, { content: { text: `edit ${i}`, format: 'markdown' } }, card.revision);
    const draft = workspace.blankDraft(card.groupId, card); draft.content.text = 'unfinished'; await workspace.saveDraft(draft);
    const saved = await storage.load('local');
    const reopened = new Workspace(saved, (...args) => storage.save(...args), undefined, undefined, { history: storage });
    check(saved.revisions.length === 2 && reopened.working.cards[0].content.text === 'unfinished', 'current state or draft lost on reopen');
    const history = await reopened.historyPage('card', card.id, { limit: 10 });
    check(history.records.length === 10 && history.next !== null, 'history was lost or read without paging');
    check((await reopened.historyPage('card', card.id, { after: history.next, limit: 10 })).records.length === 10, 'history continuation lost');
    await window.recordPhase('complete/current-only backup and staged replacement');
    const backup = await createBackup({ workspace: reopened, storage });
    check(backup.manifest.counts.revisions === 27 && backup.manifest.coverage.mode === 'complete-retained-history', 'complete history lost');
    const partial = await createBackup({ workspace: reopened, storage, coverage: 'current-state-only' });
    const portable = await openBackup(partial.bytes, { requireCurrent: true });
    check(portable.manifest.counts.revisions === 2 && portable.manifest.counts.pendingRevisions === 0, 'unknown parents became missing dependencies');
    const plan = await prepareLocalRestore({ workspace: reopened, document: portable, workAreas: [{ x: 0, y: 0, width: 1200, height: 900 }] });
    await reopened.applyRestore(plan, { persist: (...args) => storage.saveWithAttachments(...args) });
    check(reopened.working.cards[0].content.text === 'unfinished' && reopened.snapshot.cards[0].id !== card.id, 'replacement lost draft or reused identity');
    check((await storage.load('local')).revisions.length === 2, 'replacement did not atomically activate current heads');
    await currentStore.reset('local'); currentStore.close();
    const legacy = `legacy-${crypto.randomUUID()}`;
    await window.recordPhase('legacy presence without conversion');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(legacy, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces', { keyPath: 'profileId' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction('workspaces', 'readwrite');
        tx.objectStore('workspaces').put({ profileId: 'local', opaqueOldData: 'preserve without decoding' });
        tx.oncomplete = () => { request.result.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
    store = await IndexedDbRecordStore.open(`new-${crypto.randomUUID()}`, { legacyName: legacy });
    check((await store.status('local')).format === 'legacy-workspace', 'legacy detection failed');
    try { await store.commit(recordTransaction('local', null), null); throw new Error('legacy was converted'); }
    catch (error) { check(error.code === 'incompatible-local-data', error.message); }
    try { await store.page('local', { collection: 'history' }); throw new Error('legacy presented as empty'); }
    catch (error) { check(error.code === 'incompatible-local-data', error.message); }
    store.close();
    return 'PASS real IndexedDB CAS, rollback, history paging, profile isolation, reopen, reset and legacy preservation';
  });
  console.log(`${name}: ${result}`);
} finally { clearTimeout(deadline); await browser.close(); }
