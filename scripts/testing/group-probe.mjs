/** Isolated real-browser group/settings regression. Usage: node scripts/testing/group-probe.mjs --url http://127.0.0.1:PORT */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { plural, t } from '../../src/i18n/index.js';

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
const capture = async text => {
  await page.locator('#new-card').click(); await page.locator('#editor-text').fill(text);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible();
};
try {
  await page.goto(base.href); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  await capture('Original group note');
  await page.locator('#add-group').click(); await page.locator('dialog[open] input').fill('Research');
  await page.locator('dialog[open]').getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.locator('#groups .group-row')).toHaveCount(2); await capture('Research note');
  let state = await read(); const [a, b] = state.groups; const positions = state.layout.placements;
  // Settings apply as soon as they are valid; there is no save button.
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
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
  state = await read(); assert.deepEqual(state.layout.grid.slots, [b.id, a.id]);
  assert.deepEqual(state.layout.placements, positions, 'remapping does not move cards');
  await page.locator('#groups .group-row').first().locator('button').first().click();
  await page.locator('body').click({ position: { x: 260, y: 20 } });
  await page.keyboard.press('Control+Shift+1'); await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingGroup', { group: 'Research' }));
  await expect(page.locator('#groups .group-row.active')).toHaveAttribute('data-group-id', b.id);
  const aCard = state.cards.find(card => card.groupId === a.id); const bCard = state.cards.find(card => card.groupId === b.id);
  await page.locator('#cycle-next').click();
  await expect(page.locator('.card.selected')).toHaveAttribute('data-card-id', bCard.id);
  const beforeFormation = (await read()).layout.placements;
  await page.locator('#stack').click(); await page.locator('#apply-formation').click();
  await expect(page.locator('#formation-dialog')).not.toBeVisible();
  const afterFormation = (await read()).layout.placements;
  assert.deepEqual(afterFormation[aCard.id], beforeFormation[aCard.id], 'group shortcut must not form the previous sidebar group');
  assert.notDeepEqual(afterFormation[bCard.id], beforeFormation[bCard.id]);
  await page.locator('.card').filter({ hasText: 'Research note' }).locator('.card-summary').dblclick();
  await page.locator('.inline-editor').fill('Research note\nKept through shortcut switching');
  await page.keyboard.press('Control+A'); await expect(page.locator('.inline-editor')).toBeVisible();
  assert.equal(await page.locator('.inline-editor').evaluate(input => input.selectionEnd - input.selectionStart), 'Research note\nKept through shortcut switching'.length);
  await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingGroup', { group: 'Research' }));
  await page.locator('.inline-editor').dispatchEvent('compositionstart');
  await page.keyboard.press('Escape'); await expect(page.locator('.inline-editor')).toBeVisible();
  await page.keyboard.press('Control+Shift+1'); await expect(page.locator('.inline-editor')).toBeVisible();
  await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingGroup', { group: 'Research' }));
  await page.locator('.inline-editor').dispatchEvent('compositionend');
  await page.keyboard.press('Control+Shift+1'); await expect(page.locator('.inline-editor')).toHaveCount(0);
  await expect(page.locator('#mode-label')).toHaveText(t('app.mode.locked'));
  await page.locator('#drafts-button').click(); await expect(page.locator('#draft-list')).toContainText('Kept through shortcut switching');
  await page.getByRole('button', { name: t('app.drafts.resume'), exact: true }).click();
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#draft-count')).toHaveText('0');
  await page.locator('body').click({ position: { x: 260, y: 20 } });
  await page.keyboard.press('Control+Shift+9'); await expect(page.locator('#mode-label')).toHaveText(t('app.mode.adjustingAll'));
  await page.locator('#stop-operation').click();

  // Archived and deleted records still appear in merge previews and keep their states.
  await page.locator('[data-view="list"]').click();
  const row = page.locator('.note-row').filter({ hasText: 'Research note' });
  await row.getByRole('button', { name: t('app.notes.more'), exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: t('app.card.archive'), exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#new-card').click(); await page.locator('#editor-text').fill('Draft that survives the merge');
  await page.locator('#keep-draft').click();
  const before = await read();
  await page.locator('#groups .group-row').nth(1).locator('.group-menu').click();
  await page.getByRole('button', { name: t('app.groupEditor.merge'), exact: true }).click();
  await expect(page.getByRole('button', { name: t('app.merge.confirm'), exact: true })).toBeDisabled();
  await page.locator('#merge-target').selectOption(a.id);
  await expect(page.locator('#merge-message')).toContainText(t('app.merge.summary', { notes: plural('app.count.notes', 1), drafts: plural('app.count.drafts', 1),
    group: t('app.groups.defaultName') }));
  await expect(page.locator('.merge-preview')).toContainText(t('app.merge.itemArchived', { note: 'Research note' }));
  await page.locator('#merge-dialog').getByRole('button', { name: t('common.cancel'), exact: true }).click();
  assert.deepEqual(await read(), before, 'cancelled preview must not write');
  await page.locator('#groups .group-row').nth(1).locator('.group-menu').click();
  await page.getByRole('button', { name: t('app.groupEditor.merge'), exact: true }).click();
  await page.locator('#merge-target').selectOption(a.id);
  await page.getByRole('button', { name: t('app.merge.confirm'), exact: true }).click();
  await expect(page.locator('#groups .group-row')).toHaveCount(1);
  state = await read(); assert.deepEqual(state.layout.placements, before.layout.placements);
  assert.equal(state.cards.find(card => card.content.text.startsWith('Research note')).archived, true);
  assert.ok(state.cards.every(card => card.groupId === a.id));
  assert.equal(state.layout.myGroupId, a.id); assert.equal(state.layout.shortcuts['Ctrl+Shift+1'], '@region1');
  assert.equal(state.layout.shortcuts['Alt+Shift+1'], '@region1'); assert.equal(state.layout.shortcuts['Ctrl+Shift+9'], '@all');
  await page.locator('#settings-button').click();
  await page.locator('#close-settings').click(); await expect(page.locator('#settings-dialog')).not.toBeVisible();
  assert.deepEqual((await read()).layout.shortcuts, state.layout.shortcuts, 'settings must retain all inherited bindings');
  await page.locator('#drafts-button').click(); await page.getByRole('button', { name: t('app.drafts.resume'), exact: true }).click();
  await expect(page.locator('#editor-group')).toHaveValue(a.id);
  await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#draft-count')).toHaveText('0');
  await page.reload(); await expect(page.locator('#status')).toHaveText(t('app.status.opened'));
  assert.equal((await read()).cards.length, 3); assert.deepEqual(errors, []);
  console.log('PASS: group preview/cancel/merge, draft recovery, archived content, fixed geometry, grid remapping and configurable shortcuts');
} finally { await context.close(); await browser.close(); }
