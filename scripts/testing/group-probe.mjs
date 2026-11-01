/** Isolated real-browser group/settings regression. Usage: node scripts/testing/group-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { plural, t } from '../../src/i18n/index.js';
import { groupColors } from '../../src/core/palette.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/group-probe.mjs --url http://127.0.0.1:PORT\nUses synthetic notes in an isolated browser profile.');
  process.exit(0);
}
const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0 && process.argv[urlIndex + 1], '--url is required');
const base = new URL(process.argv[urlIndex + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/app/index.html'; const profile = `groups-${crypto.randomUUID()}`; base.searchParams.set('profile', profile);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, locale: 'en-US' });
const page = await context.newPage(); const errors = [];
page.on('pageerror', error => errors.push(error.message));
const read = () => page.evaluate(async profile => {
  const { IndexedDbStorage } = await import('../storage/indexed-db.js');
  const storage = await IndexedDbStorage.open(); const state = await storage.load(profile); storage.close(); return state;
}, profile);
// Capture floats over a group's board or list, not over the canvas of every group.
const capture = async text => {
  await page.locator('[data-view="board"]').click(); await page.locator('#compose').click(); await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
try {
  await page.goto(base.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  await capture('Original group note');
  await page.locator('#add-group').click(); await page.locator('dialog[open] input:not([type=radio])').fill('Research');
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.locator('#groups .group-row')).toHaveCount(2);
  const created = await read(); assert.equal(created.layout.mainGroupId, created.groups[1].id, 'a new group is shown and remembered');
  // A note filed into another group from the editor shows and remembers that group, as a sidebar choice does.
  await page.locator('#groups .group-row').first().locator('button').first().click();
  await expect.poll(async () => (await read()).layout.mainGroupId).toBe(created.groups[0].id);
  await page.locator('#compose').click(); await page.locator('#editor-text').fill('Research note');
  await page.locator('#editor-group').selectOption(created.groups[1].id);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('#groups .group-row.active')).toHaveAttribute('data-group-id', created.groups[1].id);
  let state = await read(); const [a, b] = state.groups; const positions = state.layout.placements;
  assert.equal(state.layout.mainGroupId, b.id, 'the group chosen in the editor is remembered');
  // Saving group settings with the name as shown, including the translated default name, records no group revision.
  for (const index of [0, 1]) {
    await page.locator('#groups .group-row').nth(index).locator('.group-menu').click();
    await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0); await expect(page.locator('#status')).toHaveText(t('app.status.groupSaved'));
  }
  assert.deepEqual((await read()).revisions, state.revisions, 'an unchanged group name must not record a revision');
  // Settings apply as soon as they are valid; there is no save button. The gear opens General.
  await page.locator('#settings-button').click(); await expect(page.locator('#settings-page-title')).toHaveText(t('settings.general.title'));
  await expect(page.locator('[data-page="general"]')).toHaveAttribute('aria-current', 'page'); await page.locator('[data-page="desktop"]').click();
  // The browser has no main window of its own, so Reset desktop layout names only the layout.
  await expect(page.locator('#reset-layout-hint')).toHaveText(t('settings.desktop.resetLayout.hint'));
  await page.getByRole('combobox', { name: t('settings.desktop.regionGroup', { number: 1 }), exact: true }).selectOption(b.id);
  await expect(page.getByRole('combobox', { name: t('settings.desktop.regionGroup', { number: 2 }), exact: true })).toHaveValue(a.id);
  // Digit keys follow regions: after the swap, region 1 holds Research and its row says so.
  await page.locator('[data-page="shortcuts"]').click();
  const regionRows = page.locator('#shortcut-regions .settings-row');
  await expect(regionRows.nth(1)).toContainText('Research'); await expect(regionRows.nth(2)).toContainText(t('app.groups.defaultName'));
  await expect(regionRows.nth(3)).toContainText(t('settings.desktop.emptyRegion'));
  const allShortcut = page.locator('[data-shortcut-target="@all"]');
  const bShortcut = page.locator('[data-shortcut-target="@region1"]'); const lastShortcut = page.locator('[data-shortcut-target="@region9"]');
  await expect(bShortcut).toHaveValue('Ctrl+Shift+1'); await expect(lastShortcut).toHaveValue('Ctrl+Shift+9');
  await bShortcut.fill('Ctrl+Shift+0'); await expect(page.locator('#shortcut-message')).toContainText(t('settings.errors.duplicateShortcut'));
  await bShortcut.press('Tab'); assert.equal((await read()).layout.shortcuts['Ctrl+Shift+0'], '@all', 'an invalid shortcut set is never applied');
  await bShortcut.fill('Ctrl+Shift+1, Alt+Shift+1'); await bShortcut.press('Tab');
  await lastShortcut.fill(''); await lastShortcut.press('Tab'); await allShortcut.fill('Ctrl+Shift+9, Ctrl+A'); await allShortcut.press('Tab');
  await expect(page.locator('#shortcut-message')).toBeHidden();
  await page.locator('[data-page="desktop"]').click(); await page.locator('#my-group').selectOption(b.id);
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect.poll(async () => (await read()).layout.myGroupId).toBe(b.id);
  // The account chip opens Account and sync, with the card above the pages; the gear still opens General afterwards.
  await page.locator('#account-button').click(); await expect(page.locator('#settings-page-title')).toHaveText(t('settings.account.title'));
  await expect(page.locator('.nav-account')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#settings-account-name')).toHaveText(t('sync.account.localNotes'));
  await page.locator('#close-settings').click(); await page.locator('#settings-button').click();
  await expect(page.locator('#settings-page-title')).toHaveText(t('settings.general.title')); await page.locator('#close-settings').click();
  // My group carries a star in the sidebar, and only My group does.
  await expect(page.locator('#groups .group-star')).toHaveCount(1);
  await expect(page.locator(`#groups .group-row[data-group-id="${b.id}"] .group-star`)).toHaveAttribute('aria-label', t('app.groups.myGroupMark'));
  state = await read(); assert.deepEqual(state.layout.grid.slots, [b.id, a.id]);
  assert.deepEqual(state.layout.placements, positions, 'remapping does not move cards');
  // The sidebar follows the regions; dragging a row or Alt+arrow keys reorder the regions without moving notes.
  const groupRow = id => page.locator(`#groups .group-row[data-group-id="${id}"]`);
  await expect(page.locator('#groups .group-row').first()).toHaveAttribute('data-group-id', b.id);
  const activeBefore = await page.locator('#groups .group-row.active').getAttribute('data-group-id');
  const from = await groupRow(a.id).boundingBox(); const to = await groupRow(b.id).boundingBox();
  await page.mouse.move(from.x + 60, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 60, to.y + 4, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await read()).layout.grid.slots).toEqual([a.id, b.id]);
  await expect(page.locator('#groups .group-row').first()).toHaveAttribute('data-group-id', a.id);
  // A toast says which region keys now act on which group.
  await expect(page.locator('#toast')).toBeVisible(); await expect(page.locator('#toast')).toContainText(t('app.groups.keysMoved'));
  await expect(page.locator('#toast')).toContainText(t('app.groups.keyMoved', { keys: 'Ctrl+Shift+2', group: 'Research' }));
  await page.locator('#toast').getByRole('button', { name: t('common.close'), exact: true }).click();
  await expect(page.locator('#toast')).toBeEmpty(); await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('#groups .group-row.active')).toHaveAttribute('data-group-id', activeBefore);
  await groupRow(a.id).locator('button').first().press('Alt+ArrowDown');
  await expect.poll(async () => (await read()).layout.grid.slots).toEqual([b.id, a.id]);
  await expect(groupRow(a.id).locator('button').first()).toBeFocused();
  assert.deepEqual((await read()).layout.placements, positions, 'reordering groups does not move cards');
  // Colours are this device's: choosing the colour another group wears swaps the two and records no group revision.
  const beforeColors = await read();
  await groupRow(a.id).locator('.group-menu').click();
  await page.locator('dialog[open] .swatch').nth(beforeColors.layout.groupColors[b.id]).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect.poll(async () => (await read()).layout.groupColors)
    .toEqual({ [a.id]: beforeColors.layout.groupColors[b.id], [b.id]: beforeColors.layout.groupColors[a.id] });
  assert.deepEqual((await read()).revisions, beforeColors.revisions, 'a colour change must not record a revision');
  await expect(groupRow(a.id).locator('.group-dot')).toHaveAttribute('style', `--group-color: ${groupColors[beforeColors.layout.groupColors[b.id]]};`);
  await groupRow(a.id).locator('button').first().click();
  // The group chosen in the sidebar is remembered on this device and comes back after a restart, though it is not first.
  await expect.poll(async () => (await read()).layout.mainGroupId).toBe(a.id);
  // A mouse drags a board paper onto another group in the sidebar: a new version of the same note, whose desktop paper
  // stays where it was. Esc cancels and the note's own group takes nothing; the status offers Undo, and the history
  // names the group each version was moved from.
  const original = page.locator('.note-paper').filter({ hasText: 'Original group note' });
  const beforeMove = await read(); const moving = beforeMove.cards.find(card => card.content.text === 'Original group note');
  const dragNote = async (row, finish) => {
    const from = await original.boundingBox(); const to = await row.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 10 }); await finish();
  };
  await dragNote(groupRow(b.id), async () => {
    await expect(groupRow(b.id)).toHaveClass(/receiving/);
    await expect(page.locator('.note-ghost')).toContainText(t('app.stage.moveTo', { group: 'Research' }));
    await page.keyboard.press('Escape'); await page.mouse.up();
  });
  await expect(page.locator('.note-ghost')).toHaveCount(0); await expect(groupRow(b.id)).not.toHaveClass(/receiving/);
  await dragNote(groupRow(a.id), async () => { await expect(groupRow(a.id)).not.toHaveClass(/receiving/); await page.mouse.up(); });
  await expect(original).toHaveCount(1); assert.deepEqual((await read()).revisions, beforeMove.revisions, 'a cancelled drag and the own group move nothing');
  await dragNote(groupRow(b.id), () => page.mouse.up());
  await expect(page.locator('#status')).toHaveText(t('app.status.movedTo', { group: 'Research' })); await expect(original).toHaveCount(0);
  const afterMove = await read(); const versions = state => state.revisions.filter(record => record.entityId === moving.id);
  assert.equal(afterMove.cards.length, beforeMove.cards.length, 'a move adds no note');
  assert.equal(afterMove.cards.find(card => card.id === moving.id).groupId, b.id);
  assert.equal(versions(afterMove).length, versions(beforeMove).length + 1);
  assert.deepEqual(versions(afterMove).at(-1).parents, [moving.revision], 'a move is one new version of the same note');
  assert.deepEqual(afterMove.layout.placements[moving.id], beforeMove.layout.placements[moving.id], 'the desktop paper stays where it was');
  await page.locator('#status-action').click(); await expect(page.locator('#status')).toHaveText(t('app.status.undone'));
  await expect(original).toHaveCount(1); assert.equal((await read()).cards.find(card => card.id === moving.id).groupId, a.id);
  await page.locator('#settings-button').click(); await page.locator('[data-page="revisions"]').click();
  await page.getByRole('button', { name: t('conflicts.tab.history'), exact: true }).click();
  await page.getByLabel(t('conflicts.history.choose')).selectOption({ label: t('conflicts.history.note', { summary: 'Original group note' }) });
  const versionMeta = page.locator('#revision-panel .revision-option .list-meta');
  await expect(versionMeta).toHaveCount(3);
  await expect(versionMeta.nth(0)).toContainText(t('conflicts.version.movedFrom', { group: 'Research' }));
  await expect(versionMeta.nth(1)).toContainText(t('conflicts.version.movedFrom', { group: t('app.groups.defaultName') }));
  await expect(versionMeta.nth(2)).toHaveText(`${t('app.groups.defaultName')} · ${t('conflicts.version.toDo')}`);
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await page.reload(); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  await expect(page.locator('#groups .group-row').first()).toHaveAttribute('data-group-id', b.id);
  await expect(page.locator('#groups .group-row.active')).toHaveAttribute('data-group-id', a.id);
  await page.locator('body').click({ position: { x: 260, y: 20 } });
  await page.keyboard.press('Control+Shift+1'); await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingGroup', { group: 'Research' }));
  await expect(page.locator('#groups .group-row.active')).toHaveAttribute('data-group-id', b.id);
  await expect.poll(async () => (await read()).layout.mainGroupId).toBe(b.id);
  const aCard = state.cards.find(card => card.groupId === a.id); const bCard = state.cards.find(card => card.groupId === b.id);
  await page.locator('#cycle-next').click();
  await expect(page.locator('.card.selected')).toHaveAttribute('data-card-id', bCard.id);
  const beforeFormation = (await read()).layout.placements;
  await page.locator('#stack').click(); await page.locator('#apply-formation').click();
  await expect(page.locator('#formation-dialog')).not.toBeVisible();
  const afterFormation = (await read()).layout.placements;
  assert.deepEqual(afterFormation[aCard.id], beforeFormation[aCard.id], 'group shortcut must not form the previous sidebar group');
  assert.notDeepEqual(afterFormation[bCard.id], beforeFormation[bCard.id]);
  // Adjust mode only arranges (SPEC-003, 2026-10-24): an adjusted paper has no Edit or "⋯", and neither a double click
  // nor Enter opens it for editing.
  await expect(page.locator('#stage .card-actions')).toHaveCount(0);
  const research = page.locator('.card').filter({ hasText: 'Research note' });
  await research.locator('.card-summary').dblclick(); await research.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.inline-editor')).toHaveCount(0);
  await expect(page.locator('#editor-dialog')).not.toBeVisible();
  await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingGroup', { group: 'Research' }));
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('#adjust-bar')).toBeHidden(); await expect(page.locator('#stop-operation')).toBeHidden();
  await page.locator('body').click({ position: { x: 260, y: 20 } });
  await page.keyboard.press('Control+Shift+9'); await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingAll'));
  await page.locator('#stop-operation').click();

  // Archived and deleted records still appear in merge previews and keep their states.
  await page.locator('[data-view="list"]').click();
  const row = page.locator('.note-row').filter({ hasText: 'Research note' });
  await row.getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.archive'), exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#compose').click(); await page.locator('#editor-text').fill('Unsaved note that survives the merge');
  await page.locator('#close-editor-button').click(); await expect(page.locator('#status')).toHaveText(t('app.status.unsavedKept'));
  const before = await read();
  await groupRow(b.id).locator('.group-menu').click();
  await page.getByRole('button', { name: t('app.groupEditor.merge'), exact: true }).click();
  await expect(page.getByRole('button', { name: t('app.merge.confirm'), exact: true })).toBeDisabled();
  await page.locator('#merge-target').selectOption(a.id);
  // The new note left unsaved counts as one of the notes that move (ADR-061).
  await expect(page.locator('#merge-message')).toContainText(t('app.merge.summary', { notes: plural('app.count.notes', 2),
    group: t('app.groups.defaultName') }));
  await expect(page.locator('.merge-preview')).toContainText(t('app.merge.itemArchived', { note: 'Research note' }));
  await page.locator('#merge-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  assert.deepEqual(await read(), before, 'cancelled preview must not write');
  await groupRow(b.id).locator('.group-menu').click();
  await page.getByRole('button', { name: t('app.groupEditor.merge'), exact: true }).click();
  await page.locator('#merge-target').selectOption(a.id);
  await page.getByRole('button', { name: t('app.merge.confirm'), exact: true }).click();
  await expect(page.locator('#groups .group-row')).toHaveCount(1);
  state = await read(); assert.deepEqual(state.layout.placements, before.layout.placements);
  assert.equal(state.cards.find(card => card.content.text.startsWith('Research note')).archived, true);
  assert.ok(state.cards.every(card => card.groupId === a.id));
  assert.equal(state.layout.myGroupId, a.id); assert.equal(state.layout.shortcuts['Ctrl+Shift+1'], '@region1');
  await expect(page.locator(`#groups .group-row[data-group-id="${a.id}"] .group-star`)).toHaveCount(1);
  assert.equal(state.layout.shortcuts['Alt+Shift+1'], '@region1'); assert.equal(state.layout.shortcuts['Ctrl+Shift+9'], '@all');
  await page.locator('#settings-button').click();
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  assert.deepEqual((await read()).layout.shortcuts, state.layout.shortcuts, 'settings must retain all inherited bindings');
  // The unsaved note moved with its group; its editor shows the receiving group, and saving it removes the dot.
  const unsavedRow = page.locator('.note-row').filter({ hasText: 'Unsaved note that survives the merge' });
  await expect(unsavedRow.locator('.unsaved-dot')).toBeVisible(); await unsavedRow.locator('.note-title').dblclick();
  await expect(page.locator('#editor-group')).toHaveValue(a.id);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('.unsaved-dot')).toHaveCount(0);

  // A completed paper leaves the desktop until this device shows completed papers, and comes back to the same place.
  await page.locator('[data-view="list"]').click();
  await page.locator('.note-row').filter({ hasText: 'Original group note' })
    .getByRole('button', { name: t('app.notes.markCompleted'), exact: true }).click();
  await page.locator('[data-view="desktop"]').click();
  const completed = page.locator('.card').filter({ hasText: 'Original group note' });
  await expect(completed).toHaveCount(0); assert.equal((await read()).layout.completedVisible, undefined);
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await expect(page.locator('#desktop-completed')).not.toBeChecked(); await page.locator('#desktop-completed').check();
  await expect.poll(async () => (await read()).layout.completedVisible).toBe(true);
  // The browser preview has no desktop layers, so quick move is not offered there.
  await expect(page.locator('#quick-move-row')).toBeHidden();
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(completed).toHaveClass(/completed/); const completedBox = await completed.boundingBox();
  const beforeHiding = await read();
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await page.locator('#desktop-completed').uncheck();
  await expect.poll(async () => (await read()).layout.completedVisible).toBe(false);
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(completed).toHaveCount(0); await expect(page.locator('.card')).toHaveCount(1);
  assert.deepEqual((await read()).revisions, beforeHiding.revisions, 'hiding completed papers records no shared revision');
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await page.locator('#desktop-completed').check(); await page.locator('#close-settings').click();
  await expect(completed).toHaveClass(/completed/); assert.deepEqual(await completed.boundingBox(), completedBox);

  // Deleting asks nothing; the status line offers to undo it, also in a phone-sized window, until the next status.
  await page.locator('[data-view="list"]').click();
  const survivor = page.locator('.note-row').filter({ hasText: 'Unsaved note that survives the merge' });
  await survivor.getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.delete'), exact: true }).click();
  await expect(page.locator('#status')).toHaveText(t('app.status.deleted')); await expect(survivor).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const undoDelete = page.locator('#status-action');
  await expect(undoDelete).toHaveText(t('app.status.undoDelete')); await expect(undoDelete).toBeInViewport();
  // A double click runs the Undo once, so the second click cannot report the restored note as changed.
  await undoDelete.dblclick(); await expect(page.locator('#status')).toHaveText(t('app.status.restored'));
  await expect(undoDelete).toBeHidden();
  // At phone width the sidebar is a closed drawer, so a mouse press and move on a note moves nothing.
  const beforePress = await read(); const pressed = await survivor.boundingBox();
  await page.mouse.move(pressed.x + 40, pressed.y + pressed.height / 2); await page.mouse.down();
  await page.mouse.move(pressed.x + 40, pressed.y + 220, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.note-ghost')).toHaveCount(0);
  assert.deepEqual((await read()).revisions, beforePress.revisions, 'a press and move at phone width moves no note');
  // At phone width the gear opens the list of pages, with the account card on top.
  await page.locator('#drawer-toggle').click(); await page.locator('#settings-button').click();
  await expect(page.locator('#settings-dialog')).toHaveClass(/listing/); await expect(page.locator('.nav-account')).toBeInViewport();
  await page.locator('.nav-account').click(); await expect(page.locator('#settings-page-title')).toHaveText(t('settings.account.title'));
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await expect(survivor).toHaveCount(1);
  assert.equal((await read()).cards.find(card => card.content.text.startsWith('Unsaved note that survives')).deleted, false);
  await page.reload(); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  assert.equal((await read()).cards.length, 3); assert.deepEqual(errors, []);
  // On a phone a finger drags a group row held still for a moment, and the grip at once; a finger that moves at once
  // scrolls the drawer instead, and the hold neither chooses the group nor leaves text selected.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true, isMobile: true });
  const handset = await phone.newPage(); handset.on('pageerror', error => errors.push(error.message));
  const phoneUrl = new URL(base.href); phoneUrl.searchParams.set('profile', `groups-${crypto.randomUUID()}`);
  await handset.goto(phoneUrl.href); await expect(handset.locator('#status')).toHaveText(t('app.status.opened'));
  await handset.locator('#drawer-toggle').tap(); await handset.locator('#add-group').tap();
  await handset.locator('dialog[open] input:not([type=radio])').fill('Research');
  await handset.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).tap();
  await expect(handset.locator('dialog[open]')).toHaveCount(0);
  if (!await handset.locator('#sidebar').isVisible()) await handset.locator('#drawer-toggle').tap();
  const rows = handset.locator('#groups .group-row'); await expect(rows).toHaveCount(2);
  const order = () => rows.evaluateAll(nodes => nodes.map(node => node.dataset.groupId));
  const chosen = () => handset.locator('#groups .group-row.active').getAttribute('data-group-id');
  const [first, second] = await order(); const chosenBefore = await chosen();
  assert.equal(await rows.nth(1).evaluate(node => getComputedStyle(node).userSelect), 'none', 'group rows carry no selectable text');
  const touch = await phone.newCDPSession(handset);
  const centre = async locator => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const slide = async (from, toY, hold) => {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    if (hold) await handset.waitForTimeout(hold);
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (toY - from.y) * step / 8 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const top = async index => (await rows.nth(index).boundingBox()).y + 4;
  await slide(await centre(rows.nth(1).locator('.group-name')), await top(0), 0);
  await handset.waitForTimeout(500); assert.deepEqual(await order(), [first, second], 'a finger that moves at once does not drag');
  await slide(await centre(rows.nth(1).locator('.group-name')), await top(0), 600);
  await expect.poll(order, { message: 'a held row drags' }).toEqual([second, first]);
  assert.equal(await chosen(), chosenBefore, 'the hold does not choose the group');
  assert.equal(await handset.evaluate(() => getSelection().toString()), '', 'the hold leaves no text selected');
  await slide(await centre(rows.nth(1).locator('.group-grip')), await top(0), 0);
  await expect.poll(order, { message: 'the grip drags at once' }).toEqual([first, second]);
  await phone.close(); assert.deepEqual(errors, []);
  console.log('PASS: settings entry points, unchanged-name saves, group preview/cancel/merge, an unsaved new note moving with its group, archived content, hidden completed papers, undo after delete, dragging a note to a sidebar group with Undo and its history, holding or gripping a group row to drag it on a phone, fixed geometry, grid remapping, sidebar reordering, colour swaps, the My group star, the remembered main-window group and configurable shortcuts');
} finally { await context.close(); await browser.close(); }
