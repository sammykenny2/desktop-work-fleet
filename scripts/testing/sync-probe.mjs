/** Real IndexedDB/FileSync regression with a synthetic transport. Usage: node scripts/testing/sync-probe.mjs --url http://127.0.0.1:PORT */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/sync-probe.mjs --url http://127.0.0.1:PORT\nVerifies synthetic FileStore replay using real browser IndexedDB. No Google account is used.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const page = await browser.newPage();
try {
  await page.goto(new URL('/app/style.css', base).href);
  const result = await page.evaluate(async () => {
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { Workspace } = await import('/core/workspace.js');
    const { FileSync } = await import('/sources/file-sync.js');
    const { sha256 } = await import('/sources/files.js');
    const { FleetError } = await import('/core/contracts.js');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const storage = await IndexedDbStorage.open(); const profiles = [crypto.randomUUID(), crypto.randomUUID()];
    const area = { x: 0, y: 0, width: 1200, height: 800 }; let sequence = 0; let loseResponse = true;
    const files = new Map(); const changes = []; const creates = []; let allocations = 0;
    const store = {
      sourceId: 'synthetic:sync-probe',
      getStartCursor: async () => String(changes.length),
      listFiles: async () => ({ files: [...files.values()].map(item => item.file) }),
      listChanges: async ({ cursor }) => ({ changes: changes.slice(Number(cursor)), cursor: String(changes.length) }),
      allocateFileId: async () => { allocations++; return `probe-${++sequence}`; },
      readFile: async ({ file }) => files.get(file.id).bytes.slice(),
      createFile: async ({ file, bytes }) => {
        creates.push(file.id);
        if (files.has(file.id)) throw new FleetError('file-exists', 'synthetic 409');
        files.set(file.id, { file, bytes: bytes.slice() }); changes.push({ id: file.id, removed: false, file });
        if (loseResponse) { loseResponse = false; throw new FleetError('network', 'synthetic response loss'); }
        return file;
      },
    };
    const persist = (state, revision) => storage.save(state, revision);
    let a = await Workspace.create({ profileId: profiles[0], deviceId: 'a', area, persist });
    const group = a.snapshot.groups[0];
    const raw = new TextEncoder().encode('<svg onload="alert(1)">\0original</svg>'); const id = await sha256(raw);
    await storage.putAttachmentBytes(profiles[0], id, raw);
    try { await storage.putAttachmentBytes(profiles[0], id, new Uint8Array([9])); throw new Error('bad attachment accepted'); }
    catch (error) { assert(error.code === 'attachment-integrity', 'bad attachment failure code'); }
    assert(await storage.getAttachment(profiles[1], id) === null, 'profile isolation');
    const card = await a.createCard({ format: 'markdown', text: 'original', attachments: [{ id, name: 'download.svg', size: raw.length }] }, group.id);
    let syncA = new FileSync({ workspace: a, storage, fileStore: store });
    try { await syncA.sync(); throw new Error('lost response accepted'); }
    catch (error) { assert(error.code === 'network', 'response-loss failure'); }
    const disk = await storage.load(profiles[0]);
    assert(disk.outbox.length === 2 && Object.values(disk.sync.uploads)[0].complete === false, 'outbox and durable reservation');
    await syncA.stop(); a = new Workspace(await storage.load(profiles[0]), persist);
    syncA = new FileSync({ workspace: a, storage, fileStore: store }); await syncA.sync();
    assert(allocations === 3 && creates[0] === creates[1], 'restart reused the file ID');
    assert((await storage.load(profiles[0])).outbox.length === 0, 'ack persisted');
    const b = await Workspace.create({ profileId: profiles[1], deviceId: 'b', area, persist, bootstrapGroup: false });
    const syncB = new FileSync({ workspace: b, storage, fileStore: store }); await syncB.sync();
    assert(b.snapshot.cards[0].content.text === 'original' && b.snapshot.groups.length === 1, 'new device imported shared content');
    const blob = await storage.getAttachment(profiles[1], id);
    assert(blob.type === 'application/octet-stream' && await sha256(new Uint8Array(await blob.arrayBuffer())) === id, 'verified remote attachment persisted');
    await a.updateCard(card.id, { content: { ...card.content, text: 'offline A' } }, card.revision);
    await b.updateCard(card.id, { content: { ...card.content, text: 'offline B' } }, card.revision);
    await syncA.sync(); await syncB.sync(); await syncA.sync();
    assert(a.revisionHeads('card', card.id).length === 2 && b.revisionHeads('card', card.id).length === 2, 'both branches retained');
    const reopened = new Workspace(await storage.load(profiles[1]), persist);
    assert(reopened.revisionHeads('card', card.id).length === 2, 'conflicts survive reopening');
    await syncA.stop(); await syncB.stop(); storage.close();
    return { sharedRevisions: reopened.state.revisions.length, branches: reopened.revisionHeads('card', card.id).length,
      responseLossRecovered: true, attachmentVerified: true, profileIsolation: true };
  });
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
