/** Isolated real-browser UI regression. Usage: node scripts/testing/browser-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/browser-probe.mjs --url http://127.0.0.1:PORT\nUses an isolated headless browser profile and synthetic notes only.');
  process.exit(0);
}
const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0 && process.argv[urlIndex + 1], '--url is required');
const base = new URL(process.argv[urlIndex + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html'; base.searchParams.set('profile', `probe-${crypto.randomUUID()}`);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base.href);
  await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await page.getByRole('button', { name: '＋ 記下想法', exact: true }).click();
  await page.getByRole('textbox', { name: '便箋內容', exact: true }).fill('# 第一件事\n\n要保留的說明。\n\n- [ ] 第一個步驟\n- [x] 已完成步驟');
  await expect(page.locator('#draft-status')).toHaveText('草稿已存本機');
  await page.getByRole('button', { name: '預覽 / checklist', exact: true }).click();
  await expect(page.locator('#editor-preview h1')).toHaveText('第一件事');
  await page.getByRole('checkbox', { name: '步驟 1', exact: true }).check();
  await page.getByRole('button', { name: '編輯', exact: true }).click();
  assert.ok((await page.locator('#editor-text').inputValue()).includes('- [x] 第一個步驟'));
  await page.locator('#attachment-input').setInputFiles({ name: 'proof.txt', mimeType: 'text/plain', buffer: Buffer.from('retained attachment') });
  await expect(page.locator('#attachments a')).toHaveText('proof.txt');
  await page.getByRole('button', { name: '保存便箋', exact: true }).click();
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('.card-summary')).toHaveText('第一件事');
  const firstCardId = await page.locator('.card').getAttribute('data-card-id');
  await page.reload(); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await expect(page.locator('.card-summary')).toHaveText('第一件事');
  await page.getByRole('button', { name: '調整全部', exact: true }).click();
  await expect(page.locator('.card')).toHaveClass(/operable/);
  await page.locator('.card-summary').dblclick();
  const inline = page.getByRole('textbox', { name: '就地編輯便箋', exact: true });
  await expect(inline).toBeVisible();
  const originalBox = await page.locator('.card').boundingBox();
  await inline.fill('# 第一件事\n\n就地編輯保存\n\n- [x] 第一個步驟');
  await inline.dblclick();
  await expect(inline).toHaveValue('# 第一件事\n\n就地編輯保存\n\n- [x] 第一個步驟');
  await inline.press('Control+Enter');
  await expect(inline).not.toBeVisible();
  assert.deepEqual(await page.locator('.card').boundingBox(), originalBox);
  await expect(page.locator('.card-body')).toContainText('就地編輯保存');
  await page.getByRole('button', { name: '新增群組', exact: true }).click();
  await page.locator('dialog[open] input').fill('研究');
  await page.locator('dialog[open]').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#groups')).toContainText('研究');
  const paper = page.locator('.card');
  const beforeDrag = await paper.boundingBox();
  const target = await page.locator('.region').nth(1).boundingBox();
  const dragTo = async shift => {
    const start = await page.locator('.card-summary').boundingBox();
    await page.mouse.move(start.x + 25, start.y + 14); await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(target.x + 80, target.y + 100, { steps: 8 });
    await page.mouse.up(); if (shift) await page.keyboard.up('Shift');
  };
  await dragTo(false);
  await expect(page.locator('#groups .group-row').first()).toContainText('1');
  // The drop re-renders the stage once its layout commit lands; measure the settled paper, not the one being replaced.
  await expect(paper).not.toHaveClass(/dragging/);
  const moved = await paper.boundingBox();
  for (const filter of ['completed', 'archived', 'deleted']) {
    await page.locator(`[data-filter="${filter}"]`).click();
    await expect(page.locator('#stage-shell')).not.toBeVisible();
    await page.locator('[data-filter="active"]').click();
    assert.deepEqual(await paper.boundingBox(), moved, `${filter} must not rescue or reflow hidden desktop`);
  }
  await page.locator('#search').fill('第一件事');
  await expect(page.locator('#stage-shell')).not.toBeVisible();
  await page.locator('#search').fill('');
  assert.deepEqual(await paper.boundingBox(), moved, 'search must preserve desktop geometry');
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect.poll(async () => (await paper.boundingBox())?.x).toBe(beforeDrag.x);
  await dragTo(true);
  await expect(page.locator('#status')).toHaveText('已移至新群組，可按復原');
  await expect(page.locator('#groups .group-row').nth(1)).toContainText('1');
  await page.getByRole('button', { name: '復原', exact: true }).click();
  await expect(page.locator('#groups .group-row').first()).toContainText('1');
  await page.locator('.card-summary').dblclick();
  await inline.fill('尚未提交但已保存的草稿'); await inline.press('Escape');
  await expect(inline).not.toBeVisible();
  await page.reload(); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await page.locator('#drafts-button').click();
  await expect(page.locator('#draft-list')).toContainText('尚未提交但已保存的草稿');
  await page.getByRole('button', { name: '繼續編輯', exact: true }).click();
  await expect(page.locator('#attachments a')).toHaveText('proof.txt');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#attachments a').click();
  const download = await downloadPromise; const stream = await download.createReadStream();
  let downloaded = ''; for await (const chunk of stream) downloaded += chunk.toString();
  assert.equal(downloaded, 'retained attachment');
  await page.getByRole('button', { name: '保存便箋', exact: true }).click();
  await expect(page.locator('#draft-count')).toHaveText('0');
  await page.locator('#new-card').click();
  await page.locator('#editor-text').fill('第二件事');
  await page.getByRole('button', { name: '保存便箋', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.locator('#operate-all').click();
  const firstPaper = page.locator(`[data-card-id="${firstCardId}"]`);
  const secondPaper = page.locator('.card').filter({ hasText: '第二件事' });
  await firstPaper.locator('.card-summary').dblclick();
  await page.locator('.inline-editor').fill('切換選卡仍保留的草稿');
  await secondPaper.locator('.card-summary').click();
  await expect(page.locator('.inline-editor')).toHaveCount(0);
  await expect(secondPaper).toHaveClass(/selected/);
  await page.locator('#drafts-button').click();
  await expect(page.locator('#draft-list')).toContainText('切換選卡仍保留的草稿');
  await page.locator('#close-drafts').click();
  // Double-clicking another paper while editing must open it even though the first click is still saving.
  await firstPaper.locator('.card-summary').dblclick(); await expect(firstPaper.locator('.inline-editor')).toBeVisible();
  await secondPaper.locator('.card-summary').dblclick(); await expect(secondPaper.locator('.inline-editor')).toBeVisible();
  await secondPaper.locator('.inline-editor').press('Escape'); await expect(page.locator('.inline-editor')).toHaveCount(0);

  // Never render attachment HTML/SVG in the application origin, including open-in-new-tab.
  await page.locator('#new-card').click();
  const attack = '<script>localStorage.setItem("attachment-script-ran","yes")</script>';
  await page.locator('#attachment-input').setInputFiles({ name: 'untrusted.html', mimeType: 'text/html', buffer: Buffer.from(attack) });
  const unsafeLink = page.locator('#attachments a'); await expect(unsafeLink).toHaveText('untrusted.html');
  const href = await unsafeLink.getAttribute('href');
  const attachmentTab = await context.newPage();
  const attachmentDownload = attachmentTab.waitForEvent('download');
  await attachmentTab.goto(href).catch(error => assert.match(error.message, /ERR_ABORTED|Download/));
  await attachmentDownload; await attachmentTab.close();
  assert.equal(await page.evaluate(() => localStorage.getItem('attachment-script-ran')), null);

  // Keep the workspace store busy to prove that pending drafts warn before navigation.
  await expect(page.locator('#draft-status')).toHaveText('草稿已存本機');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('work-fleet-v1'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('workspaces', 'readwrite');
      let hold = true; window.releaseProbeWrite = () => { hold = false; };
      const again = () => { const request = tx.objectStore('workspaces').get('probe-busy'); request.onsuccess = () => { if (hold) again(); }; };
      tx.oncomplete = () => db.close(); again(); resolve();
    };
  }));
  await page.locator('#editor-text').fill('尚在寫入中的重要草稿');
  await expect(page.locator('#draft-status')).toHaveText('正在保存草稿…');
  const unloadDialog = page.waitForEvent('dialog');
  page.once('dialog', dialog => dialog.dismiss());
  await page.evaluate(() => { location.reload(); });
  const warning = await unloadDialog; assert.equal(warning.type(), 'beforeunload');
  await expect(page.locator('#editor-text')).toHaveValue('尚在寫入中的重要草稿');
  await page.evaluate(() => window.releaseProbeWrite());
  await expect(page.locator('#draft-status')).toHaveText('草稿已存本機');
  await page.locator('#keep-draft').click();
  await page.reload(); await expect(page.locator('#status')).toHaveText('已開啟本機資料');
  await page.setViewportSize({ width: 390, height: 844 });
  // Phones keep the sidebar in a drawer that opens only from the app bar button.
  await expect(page.locator('#drafts-button')).not.toBeInViewport(); await page.locator('#drawer-toggle').click();
  await expect(page.locator('#drafts-button')).toBeVisible();
  await expect(page.locator('#settings-button')).toBeVisible();
  await page.locator('#drafts-button').click();
  await expect(page.locator('#draft-list')).toContainText('尚在寫入中的重要草稿');
  await page.locator('#close-drafts').click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  const other = await context.newPage(); await other.goto(base.href);
  await expect(other.locator('#status')).toContainText('已在另一個視窗開啟'); await other.close();
  const storageResult = await page.evaluate(async () => {
    const { IndexedDbStorage } = await import('../storage/indexed-db.js');
    const { Workspace } = await import('../core/workspace.js');
    const name = `work-fleet-storage-probe-${crypto.randomUUID()}`;
    let db = await IndexedDbStorage.open(name);
    const initial = await Workspace.create({ profileId: 'first', deviceId: 'test', area: { x: 0, y: 0, width: 1000, height: 800 },
      persist: (state, revision) => db.save(state, revision) });
    const rival = new Workspace(initial.state, (state, revision) => db.save(state, revision));
    const results = await Promise.allSettled([initial.createGroup('first writer'), rival.createGroup('second writer')]);
    const persisted = await db.load('first');
    let invalidRevision;
    try { await db.save({ ...persisted, revision: persisted.revision + 2 }, persisted.revision); }
    catch (error) { invalidRevision = error.code; }
    const metadata = await db.putAttachment('first', new File(['bytes survive'], 'test.txt', { type: 'text/plain' }));
    const foreignAttachment = await db.getAttachment('second', metadata.id);
    db.close(); db = await IndexedDbStorage.open(name);
    const reopened = await db.load('first'); const blob = await db.getAttachment('first', metadata.id);
    const foreignProfile = await db.load('second');
    const result = { statuses: results.map(item => item.status).sort(),
      staleCode: results.find(item => item.status === 'rejected').reason.code,
      groupCount: reopened.groups.length, invalidRevision, same: JSON.stringify(persisted) === JSON.stringify(reopened),
      bytes: await blob.text(), foreignAttachment, foreignProfile };
    db.close(); return result;
  });
  assert.deepEqual(storageResult, { statuses: ['fulfilled', 'rejected'], staleCode: 'stale-writer',
    groupCount: 2, invalidRevision: 'invalid-revision', same: true, bytes: 'bytes survive', foreignAttachment: null, foreignProfile: null });
  const sanitized = await page.evaluate(async () => {
    const { renderMarkdown } = await import('./markdown.js');
    const target = document.createElement('div');
    renderMarkdown(target, '<script>window.pwned=true</script>\n\n<img src="https://invalid.example/track" onerror="window.pwned=true">\n\n[unsafe](javascript:alert(1))');
    return { scripts: target.querySelectorAll('script,iframe,img').length,
      unsafeLinks: [...target.querySelectorAll('a')].filter(link => /^javascript:/i.test(link.getAttribute('href') || '')).length };
  });
  assert.deepEqual(sanitized, { scripts: 0, unsafeLinks: 0 });
  await mkdir('build', { recursive: true });
  await page.screenshot({ path: 'build/browser-probe.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: capture, Markdown/checklist, attachment isolation, reload, inline edit, drag/undo, hidden-stage geometry, draft recovery, pending-write warning, mobile access, single writer and CAS');
} catch (error) {
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/browser-probe-failure.png', fullPage: true });
  if (errors.length) console.error('Browser page errors:', errors);
  throw error;
} finally { await context.close(); await browser.close(); }
