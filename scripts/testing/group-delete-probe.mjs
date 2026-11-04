/** Sections with no group and deleting groups (ADR-067). Usage: node scripts/testing/group-delete-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { plural, t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/group-delete-probe.mjs --url http://127.0.0.1:PORT\nOpens a new profile with no group, writes the first note, deletes groups down to none, and restores notes from Trash, at computer and phone widths. Uses synthetic notes in an isolated browser profile.');
  process.exit(0);
}
const index = process.argv.indexOf('--url'); assert.ok(index >= 0 && process.argv[index + 1], '--url is required');
const base = new URL(process.argv[index + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
const run = crypto.randomUUID();
base.pathname = '/app/index.html'; base.searchParams.set('profile', `local-group-delete-${run}`);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));

const rows = page.locator('#groups .group-row[data-group-id]');
const row = name => rows.filter({ hasText: name });
const note = text => page.locator('#list [data-card-id]', { hasText: text });
const opened = () => expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
const saveDialog = async () => { await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click(); await expect(page.locator('dialog[open]')).toHaveCount(0); };
const saveNote = async text => {
  await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
const openDelete = async name => {
  await row(name).locator('.group-menu').click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.groupEditor.delete'), exact: true }).click();
  await expect(page.locator('#confirm-dialog')).toBeVisible();
};
const confirmDelete = () => page.locator('#confirm-dialog .danger').click();
const trash = page.locator('#groups .trash-row button');
const restore = async text => {
  await note(text).hover(); await note(text).getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
};
const noGroupsShown = async title => {
  await expect(rows).toHaveCount(0);
  await expect(page.locator('#groups .section-empty')).toHaveText(t('app.sections.empty'));
  await expect(page.locator('#workspace-title')).toHaveText(title);
  await expect(page.locator('.first-note h2')).toHaveText(t('app.empty.title'));
  await expect(page.locator('.first-note button')).toHaveText(t('app.empty.add'));
  for (const hidden of ['.view-filters', '.view-switch', '#compose']) await expect(page.locator(hidden)).toBeHidden();
  for (const off of ['#operate-group', '#operate-all']) await expect(page.locator(off)).toBeDisabled();
  await expect(page.locator('#search')).toBeEnabled();
};

try {
  // A new profile holds no group, with nothing selected, and stays so until a note needs one.
  await page.goto(base.href); await opened();
  await noGroupsShown(t('app.sections.local'));
  await page.screenshot({ path: 'build/group-delete-empty-computer.png' });
  await page.reload(); await opened(); await noGroupsShown(t('app.sections.local'));

  // Trash still opens, and with no group row to choose, its own row leads back.
  await trash.click(); await expect(page.locator('#workspace-title')).toHaveText(t('app.trash.title')); await expect(page.locator('.first-note')).toHaveCount(0);
  await trash.click(); await noGroupsShown(t('app.sections.local'));

  // The first note makes the one group, and the usual page returns.
  await page.locator('.first-note button').click(); await expect(page.locator('#editor-dialog')).toBeVisible();
  await saveNote('First note');
  await expect(rows).toHaveCount(1); await expect(row(t('app.groups.defaultName'))).toHaveCount(1); await expect(note('First note')).toBeVisible();
  await expect(page.locator('.first-note')).toHaveCount(0);
  await expect(page.locator('#workspace-title')).toHaveText(t('app.groups.defaultName'));
  for (const shown of ['.view-filters', '.view-switch', '#compose']) await expect(page.locator(shown)).toBeVisible();
  for (const on of ['#operate-group', '#operate-all']) await expect(page.locator(on)).toBeEnabled();

  // Deleting asks first, says what goes where, and Cancel leaves everything.
  await page.locator('#add-group').click(); await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Second'); await saveDialog();
  await page.locator('#compose').click(); await saveNote('Second note');
  await openDelete('Second');
  await expect(page.locator('#confirm-dialog h2')).toHaveText(t('app.groupDelete.title', { group: 'Second' }));
  await expect(page.locator('#confirm-dialog p')).toHaveText(plural('app.groupDelete.notes', 1));
  await page.screenshot({ path: 'build/group-delete-confirm-computer.png' });
  await page.locator('#confirm-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await expect(rows).toHaveCount(2); await expect(note('Second note')).toBeVisible();

  // Deleted, the group leaves the list and the page moves on to the group left.
  await openDelete('Second'); await confirmDelete();
  await expect(rows).toHaveCount(1); await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('app.status.groupDeletedNotes'));
  await expect(page.locator('#workspace-title')).toHaveText(t('app.groups.defaultName'));

  // In Trash the note says its group is gone, and restoring asks for another.
  await trash.click(); await expect(note('Second note')).toBeVisible();
  await expect(page.locator('#list .trash-head .gone')).toHaveText(t('app.trash.groupGone'));
  await restore('Second note');
  await expect(page.locator('#restore-target')).toBeVisible();
  await page.locator('#restore-target').getByRole('button', { name: t('app.notes.restore'), exact: true }).click();
  await expect(page.locator('#restore-target')).toHaveCount(0);
  await row(t('app.groups.defaultName')).locator('button').first().click(); await expect(note('Second note')).toBeVisible();

  // An empty group says it has no notes, and leaves no trace in Trash.
  await page.locator('#add-group').click(); await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Empty'); await saveDialog();
  await openDelete('Empty');
  await expect(page.locator('#confirm-dialog p')).toHaveText(t('app.groupDelete.empty')); await confirmDelete();
  await expect(rows).toHaveCount(1); await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('app.status.groupDeleted'));

  // The last group cannot merge, but it can go, and the page returns to where it started.
  await row(t('app.groups.defaultName')).locator('.group-menu').click();
  await expect(page.locator('dialog[open]').getByRole('button', { name: t('app.groupEditor.merge'), exact: true })).toBeDisabled();
  await page.locator('dialog[open]').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await openDelete(t('app.groups.defaultName'));
  await expect(page.locator('#confirm-dialog p')).toHaveText(plural('app.groupDelete.notes', 2)); await confirmDelete();
  await noGroupsShown(t('app.sections.local'));
  await page.reload(); await opened(); await noGroupsShown(t('app.sections.local'));

  // Search still finds what Trash holds, with no group anywhere.
  await page.locator('#search').fill('First'); await expect(page.locator('#workspace-title')).toHaveText(t('app.search.title'));
  await expect(page.locator('.first-note')).toHaveCount(0);
  await page.locator('#search').fill(''); await noGroupsShown(t('app.sections.local'));

  // With no group left, restoring brings the note's own group back.
  await trash.click(); await restore('First note');
  await expect(page.locator('#restore-target')).toHaveCount(0);
  await expect(rows).toHaveCount(1); await expect(row(t('app.groups.defaultName'))).toHaveCount(1);
  // A browser reopens on its desktop canvas, so ask for the board.
  await row(t('app.groups.defaultName')).locator('button').first().click(); await page.locator('[data-view="board"]').click(); await expect(note('First note')).toBeVisible();
  await expect(note('Second note')).toHaveCount(0);

  // With two sections, a group in either one is somewhere to write, so the empty one stays empty.
  const both = new URL(base.href); both.searchParams.set('profile', `google:group-delete-${run}`); both.searchParams.set('companion', `local-both-${run}`);
  await page.goto(both.href); await opened();
  await expect(rows).toHaveCount(0); await expect(page.locator('#groups .section-empty')).toHaveCount(2);
  await expect(page.locator('#workspace-title')).toHaveText(t('app.sections.cloud')); await expect(page.locator('.first-note')).toBeVisible();
  // Before the first sync a cloud group cannot be made yet, and the page says so.
  await page.locator('.first-note button').click();
  await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('errors.common.initialSyncRequired')); await expect(page.locator('#editor-dialog')).not.toBeVisible(); await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: t('app.sections.addGroup', { section: t('app.sections.local') }), exact: true }).click();
  await page.locator('dialog[open] input:not([type=radio],[type=checkbox])').fill('Home'); await saveDialog();
  await expect(rows).toHaveCount(1); await expect(page.locator('.first-note')).toBeHidden(); await expect(page.locator('#groups .section-empty')).toHaveCount(1);
  await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); await saveNote('Home note');
  await expect(rows).toHaveCount(1); await expect(note('Home note')).toBeVisible();
  await row('Home').locator('.group-menu').click();
  await expect(page.locator('dialog[open]').getByRole('button', { name: t('app.groupEditor.moveTo', { section: t('app.sections.cloud') }), exact: true })).toBeVisible();
  await page.screenshot({ path: 'build/group-delete-dialog-computer.png' });
  await page.locator('dialog[open]').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  await openDelete('Home'); await confirmDelete();
  await expect(rows).toHaveCount(0); await expect(page.locator('#groups .section-empty')).toHaveCount(2); await expect(page.locator('.first-note')).toBeVisible();
  assert.deepEqual(errors, []);

  // On a phone the prompt stands alone, with the sidebar in its drawer, and the group's dialog fits with every button.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true, isMobile: true });
  const handset = await phone.newPage(); handset.on('pageerror', error => errors.push(error.message));
  const phoneUrl = new URL(both.href); phoneUrl.searchParams.set('profile', `local-group-delete-phone-${run}`); phoneUrl.searchParams.set('companion', `local-phone-second-${run}`);
  await handset.goto(phoneUrl.href); await expect(handset.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(handset.locator('.first-note button')).toBeInViewport();
  await handset.screenshot({ path: 'build/group-delete-empty-phone.png' });
  await handset.locator('.first-note button').tap();
  await handset.locator('#editor-text').fill('Phone note');
  await handset.getByRole('button', { name: t('app.editor.save'), exact: true }).tap(); await expect(handset.locator('#editor-dialog')).not.toBeVisible();
  await handset.locator('#drawer-toggle').tap(); await handset.locator('#groups .group-menu').first().tap();
  const buttons = handset.locator('dialog[open] .dialog-actions button');
  for (let at = 0; at < await buttons.count(); at++) await expect(buttons.nth(at)).toBeInViewport();
  await handset.screenshot({ path: 'build/group-delete-dialog-phone.png' });
  await phone.close();
  assert.deepEqual(errors, []);
  console.log('PASS: a new profile opens with no group until a note needs one, and any group can be deleted down to none, with its notes restorable.');
} catch (error) {
  await page.screenshot({ path: 'build/group-delete-failure.png' }).catch(() => {});
  throw error;
} finally { await browser.close(); }
