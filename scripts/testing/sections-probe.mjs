/** Isolated real-browser regression of cloud and local sections. Usage: node scripts/testing/sections-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/sections-probe.mjs --url http://127.0.0.1:PORT\nOpens two synthetic profiles in an isolated browser profile; nothing reaches Google.');
  process.exit(0);
}
const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0 && process.argv[urlIndex + 1], '--url is required');
const base = new URL(process.argv[urlIndex + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const run = crypto.randomUUID(); const cloud = `google:probe-${run}`; const local = `local-${run}`;
base.pathname = '/app/index.html'; base.searchParams.set('profile', cloud); base.searchParams.set('companion', local);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const read = id => page.evaluate(async profile => {
  const { IndexedDbRecordStore } = await import('/storage/records-indexed-db.js');
  const { WorkspaceRecordStorage } = await import('/storage/workspace-records.js');
  const { Workspace } = await import('/core/workspace.js');
  const storage = new WorkspaceRecordStorage(await IndexedDbRecordStore.open(), profile);
  try { for (let attempt = 0; attempt < 20; attempt++) {
    try { const state = new Workspace(await storage.load(profile), async () => {}).state; state.desk = await storage.getControl('desk'); return state; }
    catch (error) { if (error.code !== 'stale-writer' || attempt === 19) throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
  } } finally { storage.close(); }
}, id);
const section = id => page.locator(`#groups .side-section[data-profile="${id}"]`);
const row = name => page.locator('#groups .group-row[data-group-id]', { hasText: name });
const note = text => page.locator('#list [data-card-id]', { hasText: text });
const addGroup = async (id, name) => {
  await section(id).locator('.section-label button').click();
  await expect(page.locator('dialog[open] h2')).toHaveText(t('app.groupEditor.newTitleIn', { section: t(id === cloud ? 'app.sections.cloud' : 'app.sections.local') }));
  await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill(name);
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
};
const capture = async text => {
  await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
const trashNote = async text => {
  await note(text).hover(); await note(text).getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.delete'), exact: true }).click(); await expect(note(text)).toHaveCount(0);
};
try {
  await page.goto(base.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));

  // One section per collection, the account's first, each with its own add button; a new section starts empty beside an account.
  assert.deepEqual(await page.locator('#groups .side-section .section-label span').allTextContents(), [t('app.sections.cloud'), t('app.sections.local')]);
  await expect(section(local)).toContainText(t('app.sections.empty')); await expect(section(cloud)).toContainText(t('app.sections.empty'));
  await addGroup(cloud, 'Work'); await addGroup(cloud, 'Plans'); await addGroup(local, 'Home');
  assert.deepEqual((await read(cloud)).groups.map(group => group.name).sort(), ['Plans', 'Work']);
  assert.deepEqual((await read(local)).groups.map(group => group.name), ['Home']);
  await expect(section(local)).not.toContainText(t('app.sections.empty'));
  await expect(section(cloud).locator('.group-row')).toHaveCount(2); await expect(section(local).locator('.group-row')).toHaveCount(1);

  // Notes go to the collection of the group they are filed in, and pickers keep them inside it.
  await row('Home').locator('button').first().click(); await capture('Local paint plan');
  await row('Work').locator('button').first().click(); await capture('Cloud budget plan'); await capture('Cloud trip plan');
  assert.equal((await read(local)).cards.length, 1); assert.equal((await read(cloud)).cards.length, 2);
  await page.locator('#compose').click();
  assert.deepEqual(await page.locator('#editor-group option').allTextContents(), ['Work', 'Plans'], 'the editor offers only its own collection');
  await page.keyboard.press('Escape'); await expect(page.locator('#editor-dialog')).not.toBeVisible();

  // A sidebar drag stays in its section and changes only that section's order.
  const regions = (await read(local)).desk.grid.slots;
  const plans = await row('Plans').boundingBox(); const work = await row('Work').boundingBox();
  await page.mouse.move(plans.x + 60, plans.y + plans.height / 2); await page.mouse.down();
  await page.mouse.move(plans.x + 60, work.y + 4, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => section(cloud).locator('.group-name').allTextContents()).toEqual(['Plans', 'Work']);
  assert.deepEqual((await read(local)).desk.grid.slots, regions, 'dragging a row moves no region');

  // Every group has its own colour across both collections.
  const desk = (await read(local)).desk; const worn = Object.values(desk.groupColors);
  assert.equal(new Set(worn).size, 3, 'colours differ across collections');

  // Search covers both, naming the collection of each result.
  await page.locator('#search').fill('plan');
  await expect(note('Local paint plan').locator('.note-origin')).toHaveText(t('app.search.originSection', { section: t('app.sections.local'),
    place: t('app.search.origin', { group: 'Home', status: t('app.filters.active') }) }));
  await expect(note('Cloud budget plan').locator('.note-origin')).toContainText(t('app.sections.cloud'));
  await page.locator('#search').fill('');

  // Trash has a tab per collection; emptying follows the tab and each collection purges its own.
  await trashNote('Cloud trip plan'); await row('Home').locator('button').first().click(); await trashNote('Local paint plan');
  const trash = page.locator('#groups .trash-row'); await expect(trash.locator('.group-count')).toHaveText('2'); await trash.locator('button').click();
  await expect(page.locator('#trash-tabs button')).toHaveCount(3); await expect(page.locator('#trash-tabs button.active')).toHaveText(t('app.trash.all'));
  await expect(page.locator('#list .trash-head .source')).toHaveText([t('app.sections.cloud'), t('app.sections.local')]);
  await mkdir('build/sections-probe', { recursive: true }); await page.screenshot({ path: 'build/sections-probe/trash.png' });
  await page.locator(`#trash-tabs [data-trash-tab="${local}"]`).click();
  await expect(page.locator('#list .note-title')).toHaveText(['Local paint plan']); await expect(page.locator('#list .trash-head .source')).toHaveCount(0);
  await expect(page.locator('#empty-trash')).toHaveText(t('app.purge.emptySection', { section: t('app.sections.local') }));
  await page.locator('#empty-trash').click(); await expect(page.locator('#purge-dialog')).toContainText(t('app.purge.device'));
  await page.locator('#confirm-purge').click();
  await expect(page.locator('#list')).toContainText(t('app.trash.empty'), { timeout: 15_000 });
  assert.equal((await read(local)).cards.length, 0); assert.equal((await read(cloud)).cards.filter(card => card.deleted).length, 1, 'the other collection keeps its Trash');
  await page.locator(`#trash-tabs [data-trash-tab="${cloud}"]`).click(); await expect(page.locator('#list .note-title')).toHaveText(['Cloud trip plan']);
  await note('Cloud trip plan').hover(); await note('Cloud trip plan').getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
  await row('Work').locator('button').first().click(); await expect(note('Cloud trip plan')).toHaveCount(1);

  // Regions hold any group of either collection; a group in no region leaves the desktop and is listed.
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  const region = number => page.getByRole('combobox', { name: t('settings.desktop.regionGroup', { number }), exact: true });
  await expect(region(1).locator('optgroup')).toHaveCount(2);
  const workId = (await read(cloud)).groups.find(group => group.name === 'Work').id;
  const held = (await read(local)).desk.grid.slots.findIndex(id => id === workId) + 1;
  await expect(page.locator('#regions-off')).toBeHidden();
  await region(held).selectOption('');
  await expect(page.locator('#regions-off .off-chip')).toContainText('Work');
  await expect.poll(async () => (await read(local)).desk.grid.slots.includes(workId)).toBe(false);
  await page.locator('#close-settings').click(); await page.locator('[data-view="desktop"]').click();
  await expect(page.locator('#stage .card', { hasText: 'Cloud budget plan' })).toHaveCount(0);
  // Taking it off does not put it back after a reload, and the desk stays.
  await page.reload(); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  assert.equal((await read(local)).desk.grid.slots.includes(workId), false);
  await expect(section(cloud).locator('.group-name')).toHaveText(['Plans', 'Work']);
  // A note made while its group is off the desktop takes its place when the group gets a region again.
  await row('Work').locator('button').first().click(); await capture('Made off the desktop');
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await region(held).selectOption(workId); await page.locator('#close-settings').click();
  await page.locator('[data-view="desktop"]').click();
  await expect(page.locator('#stage .card', { hasText: 'Cloud budget plan' })).toHaveCount(1);
  await expect(page.locator('#stage .card', { hasText: 'Made off the desktop' })).toHaveCount(1);
  await page.screenshot({ path: 'build/sections-probe/desktop.png' });

  // Backups and versions work on one collection at a time.
  await page.locator('#settings-button').click(); await page.locator('[data-page="data"]').click();
  const pickData = page.locator('#data-host .collection-picker select');
  await expect(pickData.locator('option')).toHaveText([t('app.sections.cloud'), t('app.sections.local')]);
  await pickData.selectOption(local); await expect(page.locator('#data-host .collection-picker select')).toHaveValue(local);
  await expect(page.locator('#backup-panel')).toBeVisible();
  await page.locator('[data-page="revisions"]').click();
  await expect(page.locator('#revisions-host .collection-picker select')).toHaveValue(cloud);
  await page.locator('#close-settings').click();
  assert.deepEqual(errors, []);

  // A single collection has one heading and no Trash tabs.
  const single = new URL(base.href); single.searchParams.delete('companion'); single.searchParams.set('profile', `local-alone-${run}`);
  await page.goto(single.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  assert.deepEqual(await page.locator('#groups .side-section .section-label span').allTextContents(), [t('app.sections.local')]);
  await expect(page.locator('#groups .group-row[data-group-id]')).toHaveCount(1);
  await page.locator('#groups .trash-row button').click(); await expect(page.locator('#trash-tabs')).toBeHidden();
  assert.deepEqual(errors, []);
  console.log('PASS: two sections with their own add buttons, notes and pickers per collection, a sidebar drag inside its section, one colour table, search naming the collection, Trash tabs and Empty Trash per collection, regions across collections with groups off the desktop after a reload, and backups and versions per collection');
} finally { await context.close(); await browser.close(); }
