/** Isolated real-browser Trash and search regression. Usage: node scripts/testing/trash-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { plural, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/trash-probe.mjs --url http://127.0.0.1:PORT\nUses synthetic notes in an isolated browser profile.');
  process.exit(0);
}
const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0 && process.argv[urlIndex + 1], '--url is required');
const base = new URL(process.argv[urlIndex + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html'; base.searchParams.set('profile', `trash-${crypto.randomUUID()}`);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const note = text => page.locator('#list [data-card-id]', { hasText: text });
// With no group yet, the first-note prompt stands in for the view bar and the capture button.
const openCapture = async () => {
  if (await page.locator('.first-note').count()) await page.locator('.first-note button').click();
  else { await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); }
};
const capture = async text => {
  await openCapture(); await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
const moreActions = async text => { await note(text).hover(); await note(text).getByRole('button', { name: t('app.notes.more'), exact: true }).click(); };
const trashNote = async text => {
  await moreActions(text); await page.locator('dialog[open]').getByRole('button', { name: t('app.card.delete'), exact: true }).click();
  await expect(note(text)).toHaveCount(0);
};
const groupRow = name => page.locator('#groups .group-row[data-group-id]', { hasText: name });
const trashRow = page.locator('#groups .trash-row');
try {
  await page.goto(base.href); await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-filter]')).toHaveCount(3);
  await capture('Alpha plan to trash'); await capture('Alpha plan to keep');
  await page.locator('#add-group').click(); await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Second');
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await capture('Beta plan older'); await capture('Beta plan newer'); await capture('Beta plan completed');
  await note('Beta plan completed').hover(); await note('Beta plan completed').getByRole('button', { name: t('app.notes.markCompleted'), exact: true }).click();
  await trashNote('Beta plan older'); await trashNote('Beta plan newer');
  await groupRow(t('app.groups.defaultName')).locator('button').first().click();
  await trashNote('Alpha plan to trash');
  await groupRow('Second').locator('button').first().click();
  await expect(trashRow.locator('.group-count')).toHaveText('3');

  // Trash has its own view: no status tabs, capture, layout map or adjusting, and it keeps the group chosen before it.
  await trashRow.locator('button').click();
  await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title'));
  await expect(page.locator('#count')).toHaveText(plural('app.count.notes', 3));
  await expect(trashRow).toHaveClass(/active/); await expect(page.locator('#groups .group-row[data-group-id].active')).toHaveCount(0);
  await expect(page.locator('.view-filters')).toBeHidden(); await expect(page.locator('#compose')).toBeHidden();
  await expect(page.locator('[data-view="desktop"]')).toBeHidden(); await expect(page.locator('#empty-trash')).toBeVisible();
  await expect(page.locator('#operate-group')).toBeDisabled(); await expect(page.locator('#operate-all')).toBeDisabled();

  // Sections follow the sidebar, the newest note first, in both views.
  const sections = () => page.locator('#list .trash-head').evaluateAll(heads => heads.map(head => head.textContent));
  const titles = () => page.locator('#list .note-title').evaluateAll(nodes => nodes.map(node => node.textContent));
  assert.deepEqual(await sections(), [`${t('app.groups.defaultName')}1`, 'Second2']);
  assert.deepEqual(await titles(), ['Alpha plan to trash', 'Beta plan newer', 'Beta plan older']);
  await page.locator('[data-view="list"]').click();
  await expect(page.locator('#list .note-row')).toHaveCount(3); assert.deepEqual(await sections(), [`${t('app.groups.defaultName')}1`, 'Second2']);
  await page.locator('[data-view="board"]').click();

  // Delete forever stays readable on a paper: white text on the danger colour.
  const danger = note('Beta plan newer').getByRole('button', { name: t('app.purge.title'), exact: true }); await note('Beta plan newer').hover();
  assert.equal(await danger.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(164, 60, 53)');

  // Searching Trash searches only Trash and keeps its sections.
  await expect(page.locator('#search')).toHaveAttribute('placeholder', t('app.trash.searchPlaceholder'));
  await page.locator('#search').fill('newer');
  assert.deepEqual(await titles(), ['Beta plan newer']); assert.deepEqual(await sections(), ['Second1']);
  await page.locator('#search').fill('nothing like this'); await expect(page.locator('#list')).toContainText(t('app.trash.noMatches'));
  await page.locator('#search').fill('');

  // Trash takes no drop: a note dragged onto it moves nowhere.
  await groupRow('Second').locator('button').first().click();
  await capture('Dragged at Trash');
  const from = await note('Dragged at Trash').boundingBox(); const to = await trashRow.boundingBox();
  await page.mouse.move(from.x + 40, from.y + 80); await page.mouse.down(); await page.mouse.move(from.x + 20, from.y + 60, { steps: 3 });
  await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 6 });
  await expect(trashRow).not.toHaveClass(/receiving/); await page.mouse.up();
  await expect(note('Dragged at Trash')).toHaveCount(1); await expect(trashRow.locator('.group-count')).toHaveText('3');

  // A region key leaves Trash for that key's group.
  await trashRow.locator('button').click();
  await page.keyboard.press('Control+Shift+1'); await expect(page.locator('#workspace-title')).not.toHaveText(t('app.trash.title'));
  // The key also steps its group through its layers, which here may begin adjusting it.
  if (await page.locator('#adjust-bar').isVisible()) await page.locator('#stop-operation').click();

  // Trash does not open over a canvas being adjusted, as search does not; it would hide what is being adjusted.
  await page.locator('[data-view="desktop"]').click(); await page.locator('#operate-all').click();
  await expect(page.locator('#adjust-bar')).toBeVisible(); await expect(trashRow.locator('button')).toBeDisabled();
  await page.locator('#stop-operation').click(); await expect(trashRow.locator('button')).toBeEnabled(); await page.locator('[data-view="board"]').click();

  // Choosing a group leaves Trash, with its tabs and adjusting back and the chosen group kept for capture.
  await groupRow('Second').locator('button').first().click();
  await expect(page.locator('#workspace-title')).toHaveText('Second'); await expect(page.locator('.view-filters')).toBeVisible();
  await expect(page.locator('#operate-group')).toBeEnabled(); await expect(page.locator('#compose')).toBeVisible();
  await trashRow.locator('button').click(); await groupRow('Second').locator('button').first().click(); await capture('Filed after Trash');
  await expect(note('Filed after Trash')).toHaveCount(1);

  // Search covers every status and group, names both, leaves Trash out and links to what matches there.
  await capture('Gamma plan archived'); await moreActions('Gamma plan archived');
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.archive'), exact: true }).click(); await expect(note('Gamma plan archived')).toHaveCount(0);
  await page.locator('#search').fill('plan');
  await expect(page.locator('.view-filters')).toBeHidden();
  assert.deepEqual((await titles()).sort(), ['Alpha plan to keep', 'Beta plan completed', 'Gamma plan archived']);
  await expect(note('Gamma plan archived').locator('.note-origin')).toHaveText(t('app.search.origin', { group: 'Second', status: t('app.filters.archived') }));
  await expect(note('Beta plan completed').locator('.note-origin')).toHaveText(t('app.search.origin', { group: 'Second', status: t('app.filters.completed') }));
  await expect(note('Alpha plan to keep').locator('.note-origin')).toHaveText(t('app.search.origin', { group: t('app.groups.defaultName'), status: t('app.filters.active') }));
  // The line stays readable where the meta row clips or hides: a phone's list.
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-view="list"]').click();
  await expect(note('Beta plan completed').locator('.note-origin')).toBeVisible();
  await page.locator('[data-view="board"]').click(); await page.setViewportSize({ width: 1280, height: 860 });
  await expect(page.locator('.trash-link')).toContainText(plural('app.trash.matches', 3));
  await page.locator('.trash-link').click();
  await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title')); await expect(page.locator('#list .note-title')).toHaveCount(3);
  await page.locator('#search').fill('');

  // Restoring takes a note back to its group, and an empty Trash says so.
  await note('Alpha plan to trash').hover(); await note('Alpha plan to trash').getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
  await expect(trashRow.locator('.group-count')).toHaveText('2');
  // Delete forever fits its paper on a phone, where two text buttons do not fit one row.
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = await note('Beta plan newer').evaluate(paper => { const box = paper.getBoundingClientRect(); return [...paper.querySelectorAll('.note-actions button')].every(button => { const own = button.getBoundingClientRect(); return own.right <= box.right + 0.5 && own.bottom <= box.bottom + 0.5; }); });
  assert.equal(fits, true, 'the Trash buttons must fit the paper on a phone');
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.locator('#empty-trash').click(); await page.locator('#confirm-purge').click();
  await expect(page.locator('#list')).toContainText(t('app.trash.empty'), { timeout: 15_000 }); await expect(page.locator('#empty-trash')).toBeDisabled();

  // A phone reaches Trash from the drawer, and the page does not overflow.
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#drawer-toggle').click(); await trashRow.locator('button').click();
  await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the phone layout overflows');
  assert.deepEqual(errors, []);
  console.log('PASS: Trash in the sidebar with its own view, sections and search, disabled adjusting, the kept capture group, search across statuses with a link to Trash, restore, Empty Trash and the phone drawer');
} finally { await context.close(); await browser.close(); }
