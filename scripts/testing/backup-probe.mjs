/** Real browser backup round-trip. Usage: node scripts/testing/backup-probe.mjs --url http://127.0.0.1:PORT */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/backup-probe.mjs --url http://127.0.0.1:PORT\nVerifies IndexedDB snapshots, attachments, ZIP, encryption and cancellation. No account is used.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const page = await browser.newPage();
try {
  // An isolated document installs only the packaged import map; it does not start the application writer.
  await page.goto(new URL('/app/style.css', base).href);
  await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports: { fflate: '/vendor/fflate.js' } }) });
  const result = await page.evaluate(async () => {
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { Workspace } = await import('/core/workspace.js');
    const { createBackup, openBackup } = await import('/backup/payload.js');
    const { prepareRestore } = await import('/backup/restore.js');
    const { canonicalJson } = await import('/sources/json.js');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const storage = await IndexedDbStorage.open(); const profileId = crypto.randomUUID();
    try {
      const area = { x: 0, y: 0, width: 1200, height: 800 };
      const workspace = await Workspace.create({ profileId, deviceId: 'backup-probe-device', area,
        persist: (state, revision) => storage.save(state, revision) });
      const raw = new Uint8Array(2 * 1024 * 1024); raw.set(new TextEncoder().encode('<script>throw "inert"</script>中文💡'));
      const attachment = await storage.putAttachment(profileId, new File([raw], '../kept.svg', { type: 'image/svg+xml' }));
      const card = await workspace.createCard({ format: 'markdown', text: '# 中文 💡\n- [x] Task', attachments: [attachment] });
      await workspace.layout.placeNew(workspace.snapshot, [area]);
      const draft = workspace.blankDraft(card.groupId, card); draft.content.text = 'draft not saved to card'; await workspace.saveDraft(draft);
      const before = await storage.load(profileId); const password = 'browser long password 中文';
      const started = performance.now(); const plain = await createBackup({ workspace, storage });
      const document = await openBackup(plain.bytes);
      assert(canonicalJson(document.data.records) === canonicalJson(before.revisions), 'all revision contents retained');
      assert(canonicalJson(document.data.layout) === canonicalJson(before.layout), 'device layout retained');
      assert(document.data.drafts[0].content.text === draft.content.text, 'uncommitted draft retained');
      const bytes = document.attachment(attachment.id); assert(bytes.length === raw.length && bytes.every((value, i) => value === raw[i]), 'attachment bytes retained');
      const encrypted = await createBackup({ workspace, storage, password });
      const decoded = await openBackup(encrypted.bytes, { password });
      assert(canonicalJson(decoded.data) === canonicalJson(document.data), 'encrypted payload retained');
      try { await openBackup(encrypted.bytes, { password: 'wrong password' }); throw new Error('wrong password accepted'); }
      catch (error) { assert(error.code === 'backup-decryption', 'password authentication'); }
      const controller = new AbortController();
      try { await createBackup({ workspace, storage, signal: controller.signal, progress: () => controller.abort() }); throw new Error('cancel succeeded'); }
      catch (error) { assert(error.code === 'backup-cancelled', 'cancellation'); }
      assert(canonicalJson(await storage.load(profileId)) === canonicalJson(before), 'export, verify and cancel perform no workspace writes');
      assert(await storage.getAttachment('other-profile', attachment.id) === null, 'profile isolation');
      const targetProfile = crypto.randomUUID();
      let target = await Workspace.create({ profileId: targetProfile, deviceId: 'restore-probe-device', area,
        persist: (state, revision) => storage.save(state, revision) });
      const initial = await storage.load(targetProfile);
      const plan = await prepareRestore({ workspace: target, document, mode: 'import', layout: 'backup', workAreas: [area] });
      const originalPut = IDBObjectStore.prototype.put; let aborted = false;
      IDBObjectStore.prototype.put = function(...args) {
        const result = originalPut.apply(this, args);
        if (!aborted && this.name === 'attachments' && args[0].profileId === targetProfile) { aborted = true; this.transaction.abort(); }
        return result;
      };
      const persist = (state, revision, attachments) => storage.saveWithAttachments(state, revision, attachments);
      try {
        await target.applyRestore(plan, { persist }); throw new Error('aborted restore succeeded');
      } catch (error) { assert(error.code === 'storage-aborted', 'real transaction abort'); }
      finally { IDBObjectStore.prototype.put = originalPut; }
      assert(aborted && canonicalJson(await storage.load(targetProfile)) === canonicalJson(initial), 'workspace and receipt rolled back');
      assert(await storage.getAttachment(targetProfile, attachment.id) === null, 'attachment rolled back');
      assert(canonicalJson(target.state) === canonicalJson(initial), 'in-memory state rolled back');
      try {
        await target.applyRestore(plan, { persist: async (...args) => { await persist(...args); throw new Error('synthetic lost acknowledgement'); } });
        throw new Error('lost acknowledgement accepted');
      } catch (error) { assert(error.message === 'synthetic lost acknowledgement', 'post-commit response loss'); }
      target = new Workspace(await storage.load(targetProfile), (state, revision) => storage.save(state, revision));
      const restored = await target.applyRestore(plan, { persist });
      assert(restored.jobId === plan.receipt.jobId && target.snapshot.cards.length === 1, 'receipt prevents duplicate after restart');
      const restoredBlob = await storage.getAttachment(targetProfile, attachment.id);
      assert(restoredBlob.size === raw.length && restoredBlob.type === 'application/octet-stream', 'restored binary attachment');
      const restoredRevision = target.state.revision;
      try { await storage.saveWithAttachments({ ...target.state, revision: restoredRevision + 1 }, restoredRevision - 1, plan.attachments); throw new Error('stale writer accepted'); }
      catch (error) { assert(error.code === 'stale-writer', 'restore CAS boundary'); }
      assert((await storage.load(targetProfile)).revision === restoredRevision, 'stale restore wrote no state');
      return { attachmentBytes: raw.length, zipBytes: plain.bytes.length, encryptedZipBytes: encrypted.bytes.length,
        elapsedMs: Math.round(performance.now() - started), encryptedRoundTrip: true, cancelledWithoutWrites: true,
        atomicRestoreAbort: true, lostAcknowledgementRecovered: true };
    } finally { storage.close(); }
  });
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
