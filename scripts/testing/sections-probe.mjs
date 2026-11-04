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
  // The link from a search counts every collection, so it shows them all, whichever tab was last open.
  await page.locator(`#trash-tabs [data-trash-tab="${local}"]`).click();
  await row('Work').locator('button').first().click(); await page.locator('#search').fill('Cloud trip');
  await page.locator('#list .trash-link').click(); await expect(page.locator('#trash-tabs button.active')).toHaveText(t('app.trash.all'));
  await expect(page.locator('#list .note-title')).toHaveText(['Cloud trip plan']); await page.locator('#search').fill('');
  // Emptying both with no connection reaches the part that needs none, and says what stays.
  await page.locator('#empty-trash').click(); await expect(page.locator('#purge-dialog')).toContainText(t('app.purge.needsConnection', { section: t('app.sections.cloud') }));
  await expect(page.locator('#purge-dialog')).toContainText(t('app.purge.device')); await expect(page.locator('#purge-dialog li')).toHaveText(['Local paint plan']);
  await page.locator('#purge-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await page.locator(`#trash-tabs [data-trash-tab="${local}"]`).click(); await expect(page.locator(`#trash-tabs [data-trash-tab="${local}"]`)).toBeFocused();
  await expect(page.locator(`#trash-tabs [data-trash-tab="${local}"]`)).toHaveAttribute('aria-pressed', 'true');
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

  // A note dragged onto a group in the other section asks first, then moves; the original waits in Trash and says where it went.
  await page.locator('[data-view="board"]').click(); await row('Work').locator('button').first().click();
  const paper = await note('Cloud budget plan').boundingBox(); const home = await row('Home').boundingBox();
  await page.mouse.move(paper.x + 60, paper.y + 90); await page.mouse.down(); await page.mouse.move(paper.x + 30, paper.y + 60, { steps: 4 });
  await page.mouse.move(home.x + 40, home.y + home.height / 2, { steps: 8 }); await expect(row('Home')).toHaveClass(/receiving/); await page.mouse.up();
  await expect(page.locator('#move-dialog h2')).toHaveText(t('app.move.noteTitle', { section: t('app.sections.local') }));
  await expect(page.locator('#move-dialog')).toContainText(t('app.move.effectToLocalNote'));
  await page.screenshot({ path: 'build/sections-probe/move-note.png' });
  await page.locator('#move-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await expect(note('Cloud budget plan')).toHaveCount(1); assert.equal((await read(local)).cards.some(card => card.content.text === 'Cloud budget plan'), false, 'cancel moves nothing');
  await page.mouse.move(paper.x + 60, paper.y + 90); await page.mouse.down(); await page.mouse.move(paper.x + 30, paper.y + 60, { steps: 4 });
  await page.mouse.move(home.x + 40, home.y + home.height / 2, { steps: 8 }); await page.mouse.up();
  await page.locator('#move-dialog').getByRole('button', { name: t('app.move.confirmNote'), exact: true }).click();
  await expect(note('Cloud budget plan')).toHaveCount(0);
  await expect.poll(async () => (await read(local)).cards.filter(card => card.content.text === 'Cloud budget plan' && !card.deleted).length).toBe(1);
  await expect(page.locator('#status')).toHaveText(t('app.move.noteDone', { section: t('app.sections.local'), group: 'Home' }));
  // A group dragged onto the other section shows its notes, then a blocking progress dialog that can stop.
  await row('Plans').locator('button').first().click();
  for (const text of ['Plan one', 'Plan two', 'Plan three', 'Plan four', 'Plan five', 'Plan six']) await capture(text);
  const plansRow = await row('Plans').boundingBox(); const localSection = await section(local).boundingBox();
  await page.mouse.move(plansRow.x + 60, plansRow.y + plansRow.height / 2); await page.mouse.down();
  await page.mouse.move(plansRow.x + 60, plansRow.y + 30, { steps: 3 }); await page.mouse.move(localSection.x + 60, localSection.y + 40, { steps: 8 });
  await expect(section(local)).toHaveClass(/receiving/); await page.screenshot({ path: 'build/sections-probe/move-group-drag.png' }); await page.mouse.up();
  await expect(page.locator('#move-dialog h2')).toHaveText(t('app.move.groupTitle', { group: 'Plans', section: t('app.sections.local') }));
  await page.screenshot({ path: 'build/sections-probe/move-group.png' });
  // A slowed page, so that the bar can be seen and Stop can be pressed the way a person presses it.
  const slow = await context.newCDPSession(page); await slow.send('Emulation.setCPUThrottlingRate', { rate: 30 });
  await page.locator('#move-dialog').getByRole('button', { name: t('app.move.confirmGroup'), exact: true }).click();
  await expect(page.locator('#move-progress')).toBeVisible();
  await expect(page.locator('#move-progress progress')).toBeVisible();
  await page.screenshot({ path: 'build/sections-probe/move-progress.png' });
  await page.locator('#move-progress').getByRole('button', { name: t('app.move.stop'), exact: true }).click({ timeout: 20_000 });
  await expect(page.locator('#move-notice h2')).toHaveText(t('app.move.stoppedTitle'), { timeout: 30_000 });
  await slow.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.screenshot({ path: 'build/sections-probe/move-stopped.png' });
  await page.locator('#move-notice').getByRole('button', { name: t('app.move.ok'), exact: true }).click();
  await expect(section(cloud).locator('.group-row', { hasText: 'Plans' })).toHaveCount(1);
  await expect(section(local).locator('.group-row', { hasText: 'Plans' })).toHaveCount(1);
  // Moving it again continues into the same group, from its settings this time, and the old group then leaves.
  await section(cloud).locator('.group-row', { hasText: 'Plans' }).locator('.group-menu').click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.groupEditor.moveTo', { section: t('app.sections.local') }), exact: true }).click();
  await expect(page.locator('#move-dialog')).toContainText(t('app.move.continuing', { group: 'Plans' }));
  await page.locator('#move-dialog').getByRole('button', { name: t('app.move.confirmGroup'), exact: true }).click();
  await expect(page.locator('#move-notice h2')).toHaveText(t('app.move.doneTitle'), { timeout: 15_000 });
  await page.locator('#move-notice').getByRole('button', { name: t('app.move.ok'), exact: true }).click();
  await expect(section(cloud).locator('.group-row', { hasText: 'Plans' })).toHaveCount(0);
  await expect(section(local).locator('.group-row', { hasText: 'Plans' })).toHaveCount(1);
  assert.equal((await read(local)).cards.filter(card => card.content.text.startsWith('Plan ') && !card.deleted).length, 6);
  assert.equal((await read(local)).groups.filter(group => group.name === 'Plans' && !group.deleted).length, 1, 'moving again used the same group');
  // The originals wait in Trash, under a group that has moved away; restoring one asks where to.
  await page.locator('#groups .trash-row button').click(); await page.locator(`#trash-tabs [data-trash-tab="${cloud}"]`).click();
  await expect(note('Plan one').locator('.note-moved')).toContainText('Plans');
  await expect(page.locator('#list .trash-head .gone')).toHaveCount(1);
  await page.screenshot({ path: 'build/sections-probe/trash-moved.png' });
  await note('Plan one').hover(); await note('Plan one').getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
  await expect(page.locator('#restore-target h2')).toHaveText(t('app.trash.restoreTitle'));
  await page.locator('#restore-target').getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
  await expect(page.locator('#restore-target')).toHaveCount(0);
  await expect.poll(async () => (await read(cloud)).cards.find(card => card.content.text === 'Plan one' && !card.deleted)?.movedTo).toBeUndefined();
  await page.locator('[data-trash-tab="all"]').click(); await row('Work').locator('button').first().click();
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
  // Like every section, it opens with no group: the first note makes one.
  await expect(page.locator('#groups .group-row[data-group-id]')).toHaveCount(0);
  await expect(page.locator('#workspace-title')).toHaveText(t('app.sections.local'));
  await expect(page.locator('.first-note')).toBeVisible();
  await page.locator('#groups .trash-row button').click(); await expect(page.locator('#trash-tabs')).toBeHidden();
  assert.deepEqual(errors, []);
  console.log('PASS: two sections with their own add buttons, notes and pickers per collection, a sidebar drag inside its section, one colour table, search naming the collection, Trash tabs and Empty Trash per collection, regions across collections with groups off the desktop after a reload, and backups and versions per collection');
} finally { await context.close(); await browser.close(); }
