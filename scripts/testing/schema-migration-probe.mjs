/** Real IndexedDB upgrade, rollback and recovery. Usage: node scripts/testing/schema-migration-probe.mjs --url http://127.0.0.1:PORT */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/schema-migration-probe.mjs --url http://127.0.0.1:PORT\nTests isolated historical databases only; no account or user workspace is opened.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/workspace-v1.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
try {
  const page = await browser.newPage(); await page.goto(new URL('/app/style.css', base).href);
  const result = await page.evaluate(async historical => {
    const { IndexedDbStorage } = await import('/storage/indexed-db.js'); const { Workspace } = await import('/core/workspace.js');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const name = `schema-probe-${crypto.randomUUID()}`;
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1); request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => { request.result.createObjectStore('workspaces', { keyPath: 'profileId' }); request.result.createObjectStore('attachments', { keyPath: ['profileId', 'id'] }); };
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = legacy.transaction(['workspaces'], 'readwrite'); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      tx.objectStore('workspaces').put(historical); tx.objectStore('workspaces').put({ ...historical, profileId: 'other' });
    }); legacy.close();
    let db = await IndexedDbStorage.open(name); const metadata = await db.putAttachment('local', new File(['keep attachment'], 'a.txt'));
    const current = await db.load('local'); assert(equal(current, historical), 'structural upgrade preserves old workspace');
    const raw = await new Promise((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const injected = new IndexedDbStorage({ transaction(stores, mode, options) {
      const tx = raw.transaction(stores, mode, options); const original = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const store = original(name);
        if (name === 'workspaces' && mode === 'readwrite') {
          const put = store.put.bind(store); store.put = value => { const request = put(value); tx.abort(); return request; };
        }
        return store;
      }; return tx;
    } });
    let failure;
    try { await Workspace.open(current, (state, revision) => injected.save(state, revision), (state, revision, from) => injected.migrate(state, revision, from)); }
    catch (error) { failure = error; }
    assert(failure && equal(await db.load('local'), historical) && await db.recovery('local', 1) === null, 'abort rolls back snapshot and candidate');
    raw.close();
    const opened = await Workspace.open(current, (state, revision) => db.save(state, revision), (state, revision, from) => db.migrate(state, revision, from));
    assert(opened.state.schemaVersion === 2 && opened.state.revision === historical.revision + 1, 'v1 to v2 committed');
    assert(equal(await db.recovery('local', 1), historical), 'original workspace preserved');
    assert(await db.recovery('other', 1) === null && equal(await db.load('other'), { ...historical, profileId: 'other' }), 'profile isolation');
    assert(await (await db.getAttachment('local', metadata.id)).text() === 'keep attachment', 'attachment survives migration');
    let stale; try { await db.migrate(opened.state, historical.revision, 1); } catch (error) { stale = error.code; }
    assert(stale === 'stale-writer' && equal(await db.recovery('local', 1), historical), 'stale CAS cannot replace snapshot');
    db.close(); db = await IndexedDbStorage.open(name);
    const reopened = await Workspace.open(await db.load('local'), (state, revision) => db.save(state, revision), () => { throw new Error('must not migrate twice'); });
    assert(reopened.state.revision === opened.state.revision, 'restart is idempotent');
    await db.saveWithAttachments({ ...reopened.state, revision: reopened.state.revision + 1 }, reopened.state.revision, [], { replaceAttachments: true });
    assert(await db.recovery('local', 1) === null && await db.getAttachment('local', metadata.id) === null, 'complete replacement clears old recovery');
    const other = await db.load('other'); await Workspace.open(other, (state, revision) => db.save(state, revision), (state, revision, from) => db.migrate(state, revision, from));
    await db.reset('other'); assert(await db.recovery('other', 1) === null && await db.load('other') === null, 'reset clears recovery');
    assert((await db.load('local')).schemaVersion === 2, 'reset preserves other profile');
    db.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    return 'PASS IndexedDB v1 structure upgrade, migration abort/retry, original recovery, attachments, CAS, restart and deletion';
  }, fixture);
  console.log(result);
} finally { await browser.close(); }
