/** A note's actions in the main window, in real browsers. Usage: node scripts/testing/note-actions-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW] */
import { chromium, webkit, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { setLocale, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/note-actions-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit] [--locale en|zh-TW]\nChecks the buttons a note offers in each state, its settings dialog, editing in place on a board paper, the full editor\'s views and tools, and what a mouse, a tap and a desktop host do with an attachment. Uses isolated profiles and writes pictures to build/note-actions-probe.');
  process.exit(0);
}
const arg = (name, fallback) => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : fallback; };
const base = new URL(arg('--url'));
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html';
const engine = arg('--browser', 'chromium'); assert.ok(['chromium', 'webkit'].includes(engine));
const locale = arg('--locale', 'en'); assert.ok(['en', 'zh-TW'].includes(locale)); setLocale(locale);
const browser = await ({ chromium, webkit })[engine].launch();
const profile = () => { const url = new URL(base); url.searchParams.set('profile', `actions-${crypto.randomUUID()}`); return url.href; };
const ready = page => expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
const name = key => ({ name: t(key), exact: true });

async function desktop() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale });
  // Where the browser has the system's save dialog, a save goes through it; it only records here what was asked for.
  await context.addInitScript(() => {
    if (!window.showSaveFilePicker) return;
    window.probeSaved = [];
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.probeSaved.push(suggestedName);
      const root = await navigator.storage.getDirectory(); return root.getFileHandle(`saved-${window.probeSaved.length}`, { create: true });
    };
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(profile()); await ready(page);
  const note = text => page.locator('#list [data-card-id]', { hasText: text });
  const toast = page.locator('.toast[data-latest=true] .toast-message');
  const capture = async text => {
    if (await page.locator('.first-note').count()) await page.locator('.first-note button').click();
    else { await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); }
    await page.locator('#editor-text').fill(text); await page.locator('#editor-form button[type=submit]').click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  };
  const labels = text => note(text).locator('.note-action').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  const hover = async (text, key) => { await note(text).hover(); await note(text).getByRole('button', name(key)).click(); };

  // Each state offers its next step first, then Trash; only To do and Completed have settings.
  await capture('Going through states');
  await page.locator('[data-view="board"]').click();
  assert.deepEqual(await labels('Going through states'), [t('app.notes.markCompleted'), t('app.card.delete'), t('app.notes.more')]);
  await hover('Going through states', 'app.notes.more');
  assert.deepEqual(await page.locator('dialog[open] .dialog-actions button').allTextContents(), [t('app.card.archive'), t('common.cancel'), t('app.card.apply')]);
  await expect(page.locator('dialog[open] select')).toBeVisible();
  await page.locator('dialog[open]').getByRole('button', name('common.cancel')).click();
  await hover('Going through states', 'app.notes.markCompleted'); await expect(note('Going through states')).toHaveCount(0);
  await page.locator('[data-filter="completed"]').click();
  assert.deepEqual(await labels('Going through states'), [t('app.notes.markToDo'), t('app.card.archive'), t('app.card.delete'), t('app.notes.more')]);
  await hover('Going through states', 'app.notes.more');
  assert.deepEqual(await page.locator('dialog[open] .dialog-actions button').allTextContents(), [t('common.cancel'), t('app.card.apply')], 'a completed note has Archive on its paper');
  await page.locator('dialog[open]').getByRole('button', name('common.cancel')).click();
  await hover('Going through states', 'app.card.archive'); await expect(note('Going through states')).toHaveCount(0);
  await page.locator('[data-filter="archived"]').click();
  assert.deepEqual(await labels('Going through states'), [t('app.card.unarchive'), t('app.card.delete')]);
  // It comes back to where it was, in the list as on the board.
  await page.locator('[data-view="list"]').click(); assert.deepEqual(await labels('Going through states'), [t('app.card.unarchive'), t('app.card.delete')]);
  await page.locator('[data-view="board"]').click();
  await hover('Going through states', 'app.card.unarchive'); await expect(toast).toHaveText(t('app.status.backToCompleted'));
  await page.locator('[data-filter="completed"]').click(); await expect(note('Going through states')).toHaveCount(1);
  await hover('Going through states', 'app.notes.markToDo'); await page.locator('[data-filter="active"]').click();

  // A double click on a note's button is one press: the second must not land on the paper sliding under the pointer.
  await capture('Stays when its neighbour goes'); await capture('Double-clicked to Trash');
  const before = await page.locator('#list [data-card-id]').count();
  await note('Double-clicked to Trash').hover(); await note('Double-clicked to Trash').getByRole('button', name('app.card.delete')).dblclick();
  await expect(page.locator('#list [data-card-id]')).toHaveCount(before - 1); await expect(note('Stays when its neighbour goes')).toHaveCount(1);
  // Trash is one press with Undo, and asks only when unsaved changes would go with the note.
  await hover('Going through states', 'app.card.delete'); await expect(note('Going through states')).toHaveCount(0);
  await expect(toast).toHaveText(t('app.status.deleted')); await page.getByRole('button', name('app.status.undoDelete')).click();
  await expect(note('Going through states')).toHaveCount(1);
  await note('Going through states').locator('.note-title').dblclick(); await page.locator('#editor-text').fill('Going through states, with changes');
  await page.locator('#close-editor-button').click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await hover('Going through states', 'app.card.delete'); await expect(page.locator('#confirm-dialog')).toBeVisible();
  await page.locator('#confirm-dialog').getByRole('button', name('common.cancel')).click(); await expect(note('Going through states')).toHaveCount(1);

  // Ctrl or Command with a double click edits a board paper in place; alone it opens the full editor.
  await capture('Written in place');
  const paper = note('Written in place'); const inline = paper.locator('textarea');
  const action = key => paper.getByRole('button', name(key));
  const open = async () => { await paper.dblclick({ modifiers: ['ControlOrMeta'] }); await expect(inline).toBeVisible(); await expect(page.locator('dialog[open]')).toHaveCount(0); };
  await open();
  assert.deepEqual(await paper.locator('.note-action').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))),
    [t('desktop.editor.trash'), t('desktop.editor.full'), t('common.cancel'), t('common.save')]);
  await expect(inline).toBeFocused();
  // Cancel with nothing changed closes at once; Esc keeps what was typed, with the dot.
  await action('common.cancel').click(); await expect(inline).toHaveCount(0);
  await open(); await page.keyboard.type(' first'); await expect(paper.locator('.draft-state')).toHaveText(t('desktop.unsaved.kept'));
  await expect(inline).toHaveValue('Written in place first'); await expect(inline).toBeFocused();
  await page.keyboard.press('Escape'); await expect(inline).toHaveCount(0); await expect(paper).toContainText('Written in place first'); await expect(paper.locator('.unsaved-dot')).toHaveCount(1);
  // Cancel with changes asks on the paper; typing takes it back and reaches the text, and a second press discards.
  await open(); await expect(inline).toHaveValue('Written in place first');
  await action('common.cancel').click(); await expect(action('common.cancel')).toHaveClass(/armed/); await expect(paper.locator('.draft-state')).toHaveText(t('desktop.editor.confirmDiscard'));
  await expect(inline).toBeVisible();
  await page.keyboard.type(' x'); await expect(action('common.cancel')).not.toHaveClass(/armed/); await expect(inline).toHaveValue('Written in place first x');
  await action('common.cancel').click(); await page.waitForTimeout(450); await action('common.cancel').click();
  await expect(inline).toHaveCount(0); await expect(paper).not.toContainText('first'); await expect(paper.locator('.unsaved-dot')).toHaveCount(0);
  // Save writes a revision; Ctrl or Command with Enter does too.
  await open(); await page.keyboard.type(' saved'); await action('common.save').click(); await expect(inline).toHaveCount(0);
  await expect(paper).toContainText('Written in place saved'); await expect(paper.locator('.unsaved-dot')).toHaveCount(0);
  await open(); await page.keyboard.type(' twice'); await page.keyboard.press('ControlOrMeta+Enter'); await expect(inline).toHaveCount(0); await expect(paper).toContainText('saved twice');
  // Esc closes wherever the focus is on the paper.
  await open(); await page.keyboard.type(' again'); await paper.locator('.note-title').click(); await expect(inline).toBeVisible();
  await page.keyboard.press('Escape'); await expect(inline).toHaveCount(0);
  await open(); await action('common.save').click(); await expect(inline).toHaveCount(0);
  // Pressing elsewhere keeps the changes and closes, as selecting another paper does on the desktop.
  await open(); await page.keyboard.type(' left'); await page.locator('#workspace-title').click(); await expect(inline).toHaveCount(0); await expect(paper.locator('.unsaved-dot')).toHaveCount(1);
  // Full editor continues the text.
  await open(); await action('desktop.editor.full').click(); await expect(page.locator('#editor-dialog')).toBeVisible();
  await expect(page.locator('#editor-text')).toHaveValue('Written in place saved twice again left');
  await page.locator('#close-editor-button').click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  // Trash asks while there are unsaved changes, and Undo brings both back.
  await open(); await action('desktop.editor.trash').click(); await expect(paper.locator('.draft-state')).toHaveText(t('desktop.editor.confirmTrash'));
  await page.waitForTimeout(450); await action('desktop.editor.trash').click(); await expect(paper).toHaveCount(0);
  await page.getByRole('button', name('app.status.undoDelete')).click(); await expect(paper).toContainText('saved twice again left');
  // A slow press on something elsewhere still does what it says, though closing redraws the notes.
  const otherGroup = page.locator('#groups .group-row[data-group-id] button').first();
  await open(); await page.locator('[data-filter="completed"]').click({ delay: 150 }); await expect(page.locator('[data-filter="completed"]')).toHaveClass(/active/); await expect(inline).toHaveCount(0);
  await page.locator('[data-filter="active"]').click();
  await open(); await page.locator('#groups .trash-row button').click({ delay: 150 }); await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title')); await expect(inline).toHaveCount(0);
  await otherGroup.click(); await expect(paper).toHaveCount(1);
  // The list has no room for it and stays with the full editor, as does a plain double click.
  await page.locator('[data-view="list"]').click(); await paper.locator('.note-title').dblclick({ modifiers: ['ControlOrMeta'] }); await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.locator('#close-editor-button').click(); await page.locator('[data-view="board"]').click();
  await paper.locator('.note-title').dblclick(); await expect(page.locator('#editor-dialog')).toBeVisible();

  // The full editor: Edit and Preview at the left, tools at the right, and the tools only while editing.
  const [mode, tool, sheet] = await Promise.all([page.locator('.editor-modes').boundingBox(), page.locator('#editor-tools').boundingBox(), page.locator('#editor-dialog').boundingBox()]);
  assert.ok(mode.x - sheet.x < 40 && sheet.x + sheet.width - (tool.x + tool.width) < 40, 'views at the left, tools at the right');
  await expect(page.locator('.editor-modes button')).toHaveText([t('app.editor.editTab'), t('app.editor.previewTab')]);
  const text = page.locator('#editor-text');
  await text.fill('one\ntwo'); await text.evaluate(node => node.setSelectionRange(0, 0));
  await page.locator('#insert-task').click(); await expect(text).toHaveValue('- [ ] one\ntwo'); await expect(text).toBeFocused();
  await page.locator('#insert-list').click(); await expect(text).toHaveValue('- one\ntwo');
  await page.locator('#insert-heading').click(); await expect(text).toHaveValue('## one\ntwo');
  await text.evaluate(node => node.setSelectionRange(7, 10)); await page.locator('#insert-bold').click(); await expect(text).toHaveValue('## one\n**two**');
  await page.keyboard.press('ControlOrMeta+b'); await expect(text).toHaveValue('## one\ntwo');
  await page.locator('#preview-tab').click(); await expect(page.locator('#editor-tools')).toBeHidden(); await expect(text).toBeHidden(); await expect(page.locator('#editor-preview h2')).toHaveText('one');
  await page.locator('#edit-tab').click(); await expect(page.locator('#editor-tools')).toBeVisible();

  // An attachment is a file, not a link: a double click and a right click, with Esc leaving the editor open.
  await page.locator('#attachment-input').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('retained') });
  const tile = page.locator('#attachments .attachment-tile'); await expect(tile).toContainText('plan.txt'); await expect(page.locator('#attachments a')).toHaveCount(0);
  await tile.click({ button: 'right' }); const menu = page.locator('.app-menu');
  await expect(menu.getByRole('menuitem')).toHaveText([t('app.attachments.save'), t('app.editor.removeAttachment')]);
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0); await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.locator('#attachments .note-action').click(); await expect(menu).toBeVisible();
  await page.locator('#editor-heading').click(); await expect(menu).toHaveCount(0);
  if (engine === 'chromium') {
    await tile.dblclick(); await expect.poll(() => page.evaluate(() => window.probeSaved)).toEqual(['plan.txt']);
    await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('app.status.attachmentSaved'));
    assert.equal(await page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('saved-1')).getFile()).text()), 'retained');
  } else { const download = page.waitForEvent('download'); await tile.dblclick(); assert.equal((await download).suggestedFilename(), 'plan.txt'); }
  await page.locator('#editor-form button[type=submit]').click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  // On a paper too; a right click there has no Remove.
  await page.locator('#list .note-paper .attachment-tile').click({ button: 'right' }); await expect(menu.getByRole('menuitem')).toHaveText([t('app.attachments.save')]);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `build/note-actions-probe-${engine}-${locale}.png`, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await context.close();
}

async function phone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale, hasTouch: engine === 'chromium', isMobile: engine === 'chromium' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(profile()); await ready(page);
  await page.locator('.first-note button').click(); await expect(page.locator('#editor-dialog')).toBeVisible();
  // The editor takes the whole screen, nothing scrolls sideways, and its answer stays in reach.
  assert.deepEqual(await page.locator('#editor-dialog').evaluate(node => { const box = node.getBoundingClientRect(); return [box.width === innerWidth, box.height === innerHeight, node.scrollWidth <= node.clientWidth]; }), [true, true, true]);
  await page.locator('#editor-text').fill('Phone note');
  await page.locator('#attachment-input').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('retained') });
  const tile = page.locator('#attachments .attachment-tile'); await expect(tile).toContainText('plan.txt');
  await expect(page.locator('#editor-form button[type=submit]')).toBeInViewport();
  const press = locator => engine === 'chromium' ? locator.tap() : locator.click();
  // A tap has no double click to wait for, so it shows the menu, along the bottom edge.
  if (engine === 'chromium') {
    await press(tile); const menu = page.locator('.app-menu'); await expect(menu).toBeVisible();
    const box = await menu.boundingBox(); assert.ok(box.x <= 16 && box.width >= 340 && box.y + box.height > 780, 'the menu sits along the bottom edge');
    await page.screenshot({ path: `build/note-actions-probe-phone-${locale}.png`, animations: 'disabled' });
    await press(page.locator('.editor-heading'));  await expect(menu).toHaveCount(0);
  }
  await press(page.locator('#editor-form button[type=submit]')); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  assert.deepEqual(errors, []);
  await context.close();
}

// A desktop host opens a file in its app, with no download and no web view menu.
async function host() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale });
  const id = 'local-note-actions-probe';
  await context.route(/\/native\/bridge\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    export const profileBridge = bridge => bridge;
    export async function connectNative() {
      window.probeOpened = [];
      return { info: { profileId: '${id}', platform: 'linux', appVersion: '0.4.0', capabilities: { recordStorage: true, attachmentFiles: true } },
        bridge: { onEvent() { return () => {}; }, onCloseRequested() { return () => {}; }, async request(method, params = {}) {
          if (method === 'attachment.open') { window.probeOpened.push(params.name); return {}; }
          if (method === 'attachment.preview') return { available: true, png: null };
          return {};
        } } };
    }` }));
  await context.route(/\/storage\/records-native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
    const store = await IndexedDbRecordStore.open();
    export class NativeRecordStore {
      constructor() { return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, (...args) => store[key](...args)])); }
    }` }));
  await context.route(/\/storage\/native\.js$/, route => route.fulfill({ contentType: 'text/javascript', body: `
    export { NativeTransfers } from '/storage/native.js?original=1';
    import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
    const journal = await IndexedDbBackupJournal.open();
    export class NativeStorage { journal() { return journal; } close() {} }` }));
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = new URL(base); url.searchParams.set('profile', id); await page.goto(url.href); await ready(page);
  await page.locator('.first-note button').click(); await page.locator('#editor-text').fill('On a desktop host');
  await page.locator('#attachment-input').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('retained') });
  const tile = page.locator('#attachments .attachment-tile'); await expect(tile).toContainText('plan.txt');
  await tile.dblclick(); await expect.poll(() => page.evaluate(() => window.probeOpened)).toEqual(['plan.txt']);
  await tile.click({ button: 'right' });
  await expect(page.locator('.app-menu').getByRole('menuitem')).toHaveText([t('app.attachments.open'), t('app.attachments.save'), t('app.editor.removeAttachment')]);
  await page.getByRole('menuitem', name('app.attachments.open')).click();
  await expect.poll(() => page.evaluate(() => window.probeOpened.length)).toBe(2);
  assert.deepEqual(errors, []);
  await context.close();
}

try {
  await desktop(); await phone(); await host();
  console.log(`PASS ${engine} ${locale}: a note's buttons in each state, its settings, editing in place on a board paper, the full editor's views and tools, and an attachment under a mouse, a tap and a desktop host`);
} finally { await browser.close(); }
