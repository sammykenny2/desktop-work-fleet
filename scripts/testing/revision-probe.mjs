/** Isolated conflict/history UI regression. Usage: node scripts/testing/revision-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/revision-probe.mjs --url http://127.0.0.1:PORT\nSeeds synthetic local revisions; does not access Google.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
let profile;
const read = () => page.evaluate(async profileId => {
  const { IndexedDbStorage } = await import('/storage/indexed-db.js');
  const storage = await IndexedDbStorage.open(); const result = await storage.load(profileId); storage.close(); return result;
}, profile);
const open = async () => {
  const url = new URL('/app/index.html', base); url.searchParams.set('profile', profile);
  await page.goto(url.href); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
};
const seed = async kind => {
  // A static resource page has no active Workspace writer. The fixture owns this new profile.
  await page.goto(new URL('/app/style.css', base).href); profile = `revisions-${crypto.randomUUID()}`;
  return page.evaluate(async ({ profileId, kind }) => {
    const { IndexedDbStorage } = await import('/storage/indexed-db.js');
    const { Workspace } = await import('/core/workspace.js');
    const { revisionRecord } = await import('/sources/revisions.js');
    const storage = await IndexedDbStorage.open(); const workspace = await Workspace.create({
      profileId, deviceId: 'test-device', area: { x: 0, y: 0, width: 1100, height: 650 },
      persist: (state, revision) => storage.save(state, revision),
    });
    const a = workspace.snapshot.groups[0]; const b = await workspace.createGroup('第二組');
    const attachment = await storage.putAttachment(profileId, new File(['<h1>download only</h1>'], 'retained.html', { type: 'text/html' }));
    const card = await workspace.createCard({ format: 'markdown', text: '原始版本', attachments: [attachment], extension: { keep: true } }, a.id);
    await workspace.layout.placeNew(workspace.snapshot, [{ x: 0, y: 0, width: 1100, height: 650 }]);
    const draft = workspace.blankDraft(a.id, card); draft.content.text = '尚未提交的草稿'; await workspace.saveDraft(draft);
    const session = await workspace.beginSync(`synthetic:${profileId}`);
    if (kind === 'branches') {
      await workspace.updateCard(card.id, { content: { ...card.content, text: '本機修改' } }, card.revision);
      await workspace.receiveRevisions([revisionRecord('card', { ...card, revision: 'remote-version', deleted: true,
        content: { ...card.content, text: '另一台刪除\n<img src=x onerror="window.bad=true">' } }, [card.revision])], { session, expectedCursor: null, cursor: 'page-1' });
    } else if (kind === 'cycle') {
      await workspace.receiveRevisions([
        revisionRecord('group', { ...a, revision: 'retire-a', deleted: true, redirectGroupId: b.id }, [a.revision]),
        revisionRecord('group', { ...b, revision: 'retire-b', deleted: true, redirectGroupId: a.id }, [b.revision]),
      ], { session, expectedCursor: null, cursor: 'page-1' });
    }
    const state = workspace.state; storage.close(); return { card, a, b, state };
  }, { profileId: profile, kind });
};

try {
  const fixture = await seed('branches'); await open();
  const initial = await read(); const localRevision = initial.cards[0].revision;
  await expect(page.locator('#conflict-count')).toHaveText('1');
  await page.locator('#conflicts-button').click();
  const dialog = page.locator('#revision-dialog'); await expect(dialog.locator('.revision-option')).toHaveCount(2);
  await expect(dialog).toContainText('本機修改'); await expect(dialog).toContainText('另一台刪除');
  assert.equal(await dialog.locator('img').count(), 0); assert.equal(await page.evaluate(() => window.bad), undefined);
  const downloadEvent = page.waitForEvent('download');
  await dialog.locator('[data-revision-id="remote-version"]').getByRole('button', { name: '下載附件：retained.html' }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'retained.html');
  assert.equal((await readFile(await download.path())).toString(), '<h1>download only</h1>');
  await dialog.locator('[data-revision-id="remote-version"]').getByRole('button', { name: '採用此刪除／合併版本' }).click();
  await expect(page.locator('#conflict-count')).toHaveText('0'); await expect(dialog).toContainText('目前沒有需要處理的版本');
  const resolved = await read(); assert.equal(resolved.cards[0].deleted, true);
  assert.deepEqual(resolved.drafts, initial.drafts); assert.deepEqual(resolved.layout.placements, initial.layout.placements);
  await dialog.getByRole('button', { name: '版本歷史', exact: true }).click();
  await expect(dialog).toContainText('本機修改');
  await dialog.locator(`[data-revision-id="${localRevision}"]`).getByRole('button', { name: '恢復為目前版本' }).click();
  const restored = await read(); assert.equal(restored.cards[0].content.text, '本機修改'); assert.equal(restored.cards[0].deleted, false);
  assert.deepEqual(restored.cards[0].content.extension, { keep: true });
  assert.deepEqual(restored.drafts, initial.drafts); assert.ok(restored.revisions.length > resolved.revisions.length);
  await dialog.getByRole('button', { name: '關閉', exact: true }).click();
  await page.reload(); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await expect(page.locator('.card-summary')).toHaveText('本機修改');
  await page.locator('#operate-all').click(); await page.locator('.card-summary').dblclick();
  await page.locator('.inline-editor').fill('比較版本前的輸入');
  await page.locator('.inline-editor').dispatchEvent('compositionstart');
  await page.locator('#conflicts-button').click(); await expect(page.locator('#revision-dialog')).toHaveCount(0);
  await page.locator('.inline-editor').dispatchEvent('compositionend');
  await page.locator('#conflicts-button').click(); await expect(page.locator('#revision-dialog')).toBeVisible();
  assert.ok(Object.values((await read()).drafts).some(draft => draft.content.text === '比較版本前的輸入'));
  await page.locator('#revision-dialog').getByRole('button', { name: '關閉', exact: true }).click();

  const cyclic = await seed('cycle'); await page.setViewportSize({ width: 390, height: 844 }); await open();
  await expect(page.locator('#groups .group-row')).toHaveCount(0);
  await expect(page.locator('#conflicts-button')).toBeInViewport(); await page.locator('#conflicts-button').click();
  await expect(page.locator('#revision-dialog')).toContainText('群組合併形成循環');
  await page.locator('[data-revision-id="retire-b"]').getByRole('button', { name: '恢復此群組' }).click();
  await expect(page.locator('#conflict-count')).toHaveText('0');
  const repaired = await read(); assert.equal(repaired.cards[0].groupId, cyclic.b.id);
  assert.deepEqual(repaired.layout.placements, cyclic.state.layout.placements);
  assert.deepEqual(repaired.drafts, cyclic.state.drafts);
  assert.deepEqual(errors, []); await page.screenshot({ path: 'build/revision-probe.png', fullPage: true });
  console.log('PASS: real-browser conflicts, HTML/attachments, delete/edit resolution, history restore, drafts/IME, mobile group-cycle recovery.');
} finally { await context.close(); await browser.close(); }
