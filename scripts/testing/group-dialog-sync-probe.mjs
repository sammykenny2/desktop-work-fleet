/** Local work and the desktop during a sync (ADR-064). Production UI, DesktopOwner and DatasetSync; synthetic host and Drive. */
import assert from 'node:assert/strict';
import { chromium, webkit, expect } from '@playwright/test';
import { DatasetTestProvider } from '../../tests/fixtures/dataset/provider.js';
import { Workspace } from '../../src/core/workspace.js';
import { WorkspaceRecordStorage } from '../../src/storage/workspace-records.js';
import { MemoryRecordStore } from '../../src/storage/records.js';
import { DatasetSync } from '../../src/sources/dataset-sync.js';
import { t } from '../../src/i18n/index.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/group-dialog-sync-probe.mjs --url http://127.0.0.1:PORT [--browser chromium|webkit]\nHolds a synthetic Drive request and checks that saving groups and notes, Adjust and a quick edit finish while Drive has not answered, and that what was saved reaches another device. Holds a landing to check that the queue still keeps click order, counts one press and lets Cancel withdraw a waiting save, and checks what happens when a sync lands under a dialog or the app closes during one. Uses isolated browser profiles and no account; it does not run a native host.');
  process.exit(0);
}
const value = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes('--url'), '--url is required');
const base = new URL(value('--url')), engine = process.argv.includes('--browser') ? value('--browser') : 'chromium';
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
assert.ok(['chromium', 'webkit'].includes(engine));
const profileId = 'google:test';

// `desktopPresentation` is what makes the renderer build the DesktopOwner and its action queue; every browser probe without
// it runs actions with no queue at all, so what the queue holds cannot be seen there.
const viewId = '00000000-0000-4000-8000-000000000002', sessionId = '00000000-0000-4000-8000-000000000001';
const bridgeModule = `
export const profileBridge = bridge => bridge;
export async function connectNative() {
  const events = new Map();
  const emit = (type, message = {}) => { for (const callback of events.get(type) ?? []) callback(message); };
  window.fixtureHostEvent = emit; window.fixtureRequests = []; window.fixtureReplies = {};
  return { info: { profileId: '${profileId}', platform: 'linux', appVersion: '0.4.0',
    capabilities: { recordStorage: true, googleFiles: true, desktopPresentation: true } },
    bridge: { onEvent(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback); return () => events.get(type).delete(callback);
      }, onCloseRequested(callback) { window.fixtureClose = callback; return () => {}; },
      async request(method, params = {}) {
        window.fixtureRequests.push(method);
        if (method === 'desktop.reply') { window.fixtureReplies[params.ticket] = params; return {}; }
        if (method === 'desktop.flush') {
          setTimeout(() => emit('desktop-flushed', { id: params.id, viewId: params.viewId, draftId: params.draftId, ok: true,
            sequence: window.fixtureReplies.edit?.result?.sequence ?? 0 })); return {};
        }
        if (method === 'google.status') return { connected: true, configured: true, accountId: 'test', email: 'probe@example.invalid' };
        if (method === 'desktop.info') return { sessionId: '${sessionId}', topology: 0, views: [{ viewId: '${viewId}', layer: 'floating', active: true, viewport: { x: 0, y: 0, width: 1200, height: 900 } }], layers: ['desktop', 'floating'], adjustOverlay: true,
          workAreas: [{ x: 0, y: 0, width: 1200, height: 900, primary: true }] };
        if (method === 'desktop.shortcuts.configure') return { registrations: [] };
        if (method === 'desktop.frame.begin') return { token: 'frame' };
        if (method === 'desktop.frame.append') return { offset: params.offset + atob(params.base64).length };
        return {};
      } } };
}`;
const recordsModule = `
import { IndexedDbRecordStore } from '/storage/records-indexed-db.js';
const store = await IndexedDbRecordStore.open();
export class NativeRecordStore {
  constructor() { return Object.fromEntries(['status', 'get', 'page', 'commit', 'getAttachment', 'close'].map(key => [key, async (...args) => {
    if (key === 'commit') { window.fixtureCommits = (window.fixtureCommits || 0) + 1; await window.fixtureCommitGate; }
    return store[key](...args);
  }])); }
}`;
const storageModule = `
export { NativeTransfers } from '/storage/native.js?original=1';
import { IndexedDbBackupJournal } from '/backup/browser-automatic.js';
const journal = await IndexedDbBackupJournal.open();
export class NativeStorage { journal() { return journal; } close() {} }`;
const googleModule = `
export class NativeGoogleDatasetStore {
  get sourceId() { return 'google-drive:test:appdata-v1'; }
  async allocateFileIds(count) {
    const result = await window.fixtureDrive('allocateFileIds', { count });
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return result.value;
  }
  constructor() {
    for (const method of ['allocateFileId', 'getStartCursor', 'getObject', 'readObject', 'createObject', 'createFolder',
      'readFile', 'createFile', 'deleteFile', 'deleteFiles', 'listObjects', 'listDatasetChanges']) this[method] = async (input = {}) => {
      const { signal, ...args } = input; signal?.throwIfAborted();
      if (args.bytes) args.bytes = Array.from(args.bytes);
      const result = await window.fixtureDrive(method, args); signal?.throwIfAborted();
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
      return ['readObject', 'readFile'].includes(method) ? Uint8Array.from(result.value) : result.value;
    };
  }
}`;

const browser = await ({ chromium, webkit })[engine].launch();
try {
  const provider = new DatasetTestProvider(), errors = [];
  const device = async deviceId => {
    const storage = new WorkspaceRecordStorage(new MemoryRecordStore(), profileId);
    const workspace = await Workspace.create({ profileId, deviceId, current: true, bootstrapGroup: false,
      area: { x: 0, y: 0, width: 1200, height: 900 }, persist: (...args) => storage.save(...args) });
    const sync = new DatasetSync({ workspace, storage, fileStore: provider }); await sync.sync();
    return { workspace, sync, storage };
  };
  const peer = await device('first-device');
  const peerPull = async () => { do await peer.sync.sync({ force: true }); while (peer.workspace.pendingCount); };
  const peerNote = async text => { await peer.workspace.createCard({ format: 'markdown', text, attachments: [] }); await peerPull(); };
  await peerNote('Existing cloud note');
  const peerHas = async (kind, text) => {
    await peerPull();
    return kind === 'group' ? peer.workspace.snapshot.groups.some(group => group.name === text && !group.deleted)
      : peer.workspace.snapshot.cards.some(card => card.content.text === text);
  };

  let holdOn = null, release = null, failHeld = null, attachmentGate = null;
  const launch = async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'en-US' });
    await context.exposeFunction('fixtureDrive', async (method, args) => {
      try {
        if (method === 'readObject' && args.file?.kind === 'attachment') await attachmentGate;
        if (method === holdOn) {
          holdOn = null; await new Promise(resolve => { release = resolve; });
          if (failHeld) { const code = failHeld; failHeld = null; throw Object.assign(new Error('Synthetic changed dataset'), { code }); }
        }
        if (args.bytes) args.bytes = Uint8Array.from(args.bytes);
        const result = method === 'allocateFileIds' ? await Promise.all(Array.from({ length: args.count }, () => provider.allocateFileId())) : await provider[method](args);
        return { ok: true, value: result instanceof Uint8Array ? Array.from(result) : result };
      } catch (error) { return { ok: false, code: error.code, message: error.message }; }
    });
    for (const [path, body] of [['native/bridge', bridgeModule], ['storage/records-native', recordsModule],
      ['storage/native', storageModule], ['native/google', googleModule]]) {
      await context.route(new RegExp(`/${path}\\.js$`), route => route.fulfill({ contentType: 'text/javascript', body }));
    }
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base.origin}/app/index.html?profile=${encodeURIComponent(profileId)}`);
    await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 15000 });
    await expect(page.locator('#google-sync')).toBeEnabled();
    return { context, page };
  };
  const { context, page } = await launch();
  const synced = () => expect(page.locator('#google-sync')).toBeEnabled();
  const settled = async () => { await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok'); await synced(); };

  const open = () => page.locator('dialog[open]').count();
  const groups = () => page.locator('#groups .group-row[data-group-id]').count();
  const groupNamed = name => page.locator('#groups .group-row[data-group-id] .group-name', { hasText: name });
  // A sync that stays inside a Drive request, as a slow connection does.
  const holdSync = async (on = 'listDatasetChanges', target = page) => {
    holdOn = on; await target.evaluate(() => window.fixtureHostEvent('host-foreground'));
    await expect.poll(() => typeof release).toBe('function');
  };
  const finishSync = async () => { release(); release = null; await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/); };
  const stillHeld = what => assert.equal(typeof release, 'function', `${what} must finish while Drive has not answered`);
  // A held Drive request leaves the queue free, so holding the queue takes a landing: a change from the other device brings
  // one, and its local write stops at the gate with the queue's turn in hand.
  const holdLanding = async text => {
    await peerNote(text);
    await page.evaluate(() => { window.fixtureCommits = 0; window.fixtureCommitGate = new Promise(resolve => { window.fixtureOpenCommits = resolve; }); });
    release(); release = null;
    await expect.poll(() => page.evaluate(() => window.fixtureCommits)).toBeGreaterThan(0);
  };
  const finishLanding = async () => { await page.evaluate(() => { window.fixtureOpenCommits(); window.fixtureCommitGate = undefined; }); await synced(); };
  const press = (selector, times = 1) => page.evaluate(([selector, times]) => {
    for (let index = 0; index < times; index++) document.querySelector(selector).click();
  }, [selector, times]);
  const dialogButton = name => page.locator('dialog[open]').getByRole('button', { name, exact: true });
  const submit = times => page.evaluate(times => { for (let index = 0; index < times; index++) document.querySelector('dialog[open] form').requestSubmit(); }, times);
  const groupDialog = async name => { await press('#add-group'); await page.locator('dialog[open]').getByRole('textbox').fill(name); };
  const noDialog = () => expect(page.locator('dialog[open]')).toHaveCount(0);
  const saveNote = async () => { await page.getByRole('button', { name: t('app.editor.save'), exact: true }).click(); await expect(page.locator('#editor-dialog')).not.toBeVisible(); };

  // Opening a note whose attachment only Drive has holds nothing: it can be edited and saved before Drive answers.
  let answerAttachments; attachmentGate = new Promise(resolve => { answerAttachments = resolve; });
  const attachment = await peer.storage.putAttachment(profileId, new Blob(['attachment bytes'], { type: 'text/plain' }));
  await peer.workspace.createCard({ format: 'markdown', text: 'Note with an attachment', attachments: [attachment] }); await peerPull();
  await page.evaluate(() => window.fixtureHostEvent('host-foreground'));
  const noteWithAttachment = page.locator('[data-card-id]', { hasText: 'Note with an attachment' }).first();
  await expect(noteWithAttachment).toBeVisible({ timeout: 15000 }); await settled();
  await noteWithAttachment.dblclick(); await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.locator('#editor-text').fill('Note with an attachment, edited'); await saveNote();
  answerAttachments(); attachmentGate = null; await settled();
  await page.waitForTimeout(200); await expect(page.locator('#attachments li')).toHaveCount(0);
  await noteWithAttachment.dblclick(); await expect(page.locator('#attachments li')).toHaveCount(1);
  await page.locator('#close-editor-button').click(); await expect(page.locator('#editor-dialog')).not.toBeVisible(); await settled();

  // Adding an attachment while reads are held leaves the editor usable, and the list ends with what the note holds, once each.
  const attachmentRows = page.locator('#attachments li');
  attachmentGate = new Promise(resolve => { answerAttachments = resolve; });
  const held = async name => ({ ...await peer.storage.putAttachment(profileId, new Blob([name], { type: 'text/plain' })), name });
  await peer.workspace.createCard({ format: 'markdown', text: 'Note with two attachments', attachments: [await held('a.txt'), await held('b.txt')] }); await peerPull();
  await page.evaluate(() => window.fixtureHostEvent('host-foreground'));
  const noteWithTwo = page.locator('[data-card-id]', { hasText: 'Note with two attachments' }).first();
  await expect(noteWithTwo).toBeVisible({ timeout: 15000 }); await settled();
  await noteWithTwo.dblclick(); await expect(page.locator('#editor-dialog')).toBeVisible();
  await page.locator('#attachment-input').setInputFiles({ name: 'c.txt', mimeType: 'text/plain', buffer: Buffer.from('added while reads were held') });
  await expect(page.locator('#attachment-input')).toBeEnabled();
  assert.equal(await page.locator('#editor-text').evaluate(node => node.readOnly), false, 'the text box must stay usable while reads are held');
  answerAttachments(); attachmentGate = null;
  await expect(attachmentRows).toHaveCount(3); await page.waitForTimeout(200); await expect(attachmentRows).toHaveCount(3);
  await page.locator('#attachments li', { hasText: 'b.txt' }).locator('.note-action').click();
  await page.getByRole('menuitem', { name: t('app.editor.removeAttachment'), exact: true }).click();
  await expect(attachmentRows).toHaveCount(2); await saveNote(); await settled(); await peerPull();
  assert.deepEqual(peer.workspace.snapshot.cards.find(card => card.content.text === 'Note with two attachments').content.attachments.map(file => file.name).sort(), ['a.txt', 'c.txt']);

  // Clicks during a sync open one dialog at once, and nothing further appears when the sync ends.
  const before = await groups();
  await holdSync(); await press('#add-group', 3);
  const openedDuring = await open();
  await finishSync(); const openedAfter = await open();
  assert.deepEqual({ openedDuring, openedAfter }, { openedDuring: 1, openedAfter: 1 }, 'three clicks during a sync must open one dialog at once and no more afterwards');
  await dialogButton(t('common.cancel')).click(); await noDialog();

  // Two groups in a row while Drive has not answered: each saves and closes at once, three presses count once, and the
  // pass that follows uploads both without waiting for the timer.
  await settled(); await holdSync();
  await groupDialog('First during sync'); await submit(3); await noDialog(); await expect(groupNamed('First during sync')).toHaveCount(1);
  await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('app.status.groupSaved'));
  await groupDialog('Second during sync'); await submit(1); await noDialog(); await expect(groupNamed('Second during sync')).toHaveCount(1);
  stillHeld('saving two groups'); assert.equal(await groups(), before + 2, 'three presses of Save must create one group');
  await finishSync(); await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 5000 });
  assert.ok(await peerHas('group', 'First during sync') && await peerHas('group', 'Second during sync'), 'groups saved during a sync must reach the other device');

  // The reported sequence: the first group's own upload is running when the second group is added and saved.
  await settled(); holdOn = 'createObject'; await groupDialog('Uploading'); await submit(1); await noDialog();
  await expect.poll(() => typeof release).toBe('function');
  await groupDialog('Added during the upload'); await submit(1); await noDialog(); await expect(groupNamed('Added during the upload')).toHaveCount(1);
  stillHeld('saving a group during an upload');
  await finishSync(); await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 5000 });
  assert.ok(await peerHas('group', 'Uploading') && await peerHas('group', 'Added during the upload'), 'both groups must reach the other device');

  // A note written while Drive has not answered is saved and reaches the other device.
  await settled(); await holdSync();
  await page.locator('#compose').click(); await page.locator('#editor-text').fill('Note written during sync'); await saveNote();
  stillHeld('saving a note');
  await finishSync(); await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 5000 });
  assert.ok(await peerHas('card', 'Note written during sync'), 'a note saved during a sync must reach the other device');

  // A sync landing under an open editor leaves the typed text alone, and the note then saves.
  await settled(); await holdSync();
  await page.locator('#compose').click(); await page.locator('#editor-text').fill('Typed before the landing');
  await peerNote('Arrived under the editor'); await finishSync();
  assert.equal(await page.locator('#editor-text').inputValue(), 'Typed before the landing'); await saveNote();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'ok', { timeout: 25000 });
  assert.ok(await peerHas('card', 'Typed before the landing'), 'a note saved after a landing must reach the other device');

  // A quick edit is frozen only for its flush, not for the pass, and desktop commands answer while Drive has not.
  await settled();
  const command = (ticket, method, serial, args) => page.evaluate(({ ticket, method, serial, args, sessionId, viewId }) => {
    window.fixtureHostEvent('desktop-command', { viewId, ticket, intent: null, topology: 0, command: { sessionId, id: crypto.randomUUID(), method, serial, args } });
  }, { ticket, method, serial, args, sessionId, viewId });
  const reply = ticket => page.evaluate(ticket => window.fixtureReplies[ticket] ?? null, ticket);
  const accepted = async ticket => { await expect.poll(() => reply(ticket)).not.toBeNull(); const answer = await reply(ticket); assert.equal(answer.ok, true, JSON.stringify(answer)); };
  await page.locator('#settings-button').click(); await page.locator('[data-page="desktop"]').click();
  await page.locator('#desktop-quick-move').check(); await page.locator('#close-settings').click(); await noDialog();
  await peerPull();
  const edited = peer.workspace.snapshot.cards.find(card => card.content.text === 'Existing cloud note');
  await command('edit', 'card.edit', 1, { cardId: edited.id });
  await accepted('edit');
  await peerNote('Arrived during a quick edit'); await holdSync('getObject');
  const requests = await page.evaluate(() => window.fixtureRequests);
  const count = method => requests.filter(value => value === method).length;
  assert.ok(count('desktop.flush') >= 1, 'a pass with work to do flushes the quick edit first');
  assert.equal(count('desktop.flush.release'), count('desktop.flush'), 'the text box must be released before Drive answers');
  const { draftId, sequence } = (await reply('edit')).result;
  await command('end', 'editor.end', 2, { draftId, sequence });
  await accepted('end'); stillHeld('a desktop command');
  await finishSync();

  // Adjust starts at once while Drive has not answered.
  const adjusting = () => page.evaluate(() => document.documentElement.inert);
  await settled(); await holdSync(); await press('#operate-all');
  await expect.poll(adjusting).toBe(true); stillHeld('starting Adjust');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect.poll(adjusting).toBe(false); await finishSync();

  // Group settings and Merge open at once too, and several presses of Merge open one merge dialog.
  await settled(); await holdSync(); await press('#groups .group-row[data-group-id] .group-menu', 3);
  assert.equal(await open(), 1, 'three clicks on group settings during a sync must open one dialog at once');
  await press('#merge-group', 3);
  await expect(page.locator('#merge-dialog')).toHaveCount(1); assert.equal(await open(), 1, 'three presses of Merge must open one merge dialog');
  stillHeld('opening Merge'); await finishSync();
  assert.equal(await open(), 1, 'a sync ending must not open another dialog');
  await dialogButton(t('common.cancel')).click(); await noDialog();

  // While a landing has the queue a save waits its turn: Save is disabled, and closing the dialog withdraws it.
  await settled(); await holdSync(); await groupDialog('Withdrawn during a landing');
  await holdLanding('Landing under a waiting save');
  await submit(3); await expect(dialogButton(t('common.save'))).toBeDisabled();
  await dialogButton(t('common.cancel')).click(); await noDialog();
  await finishLanding();
  await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/);
  assert.equal(await groupNamed('Withdrawn during a landing').count(), 0, 'a cancelled save must not create a group');

  // A save waiting behind a landing goes through once when the landing ends.
  await settled(); await holdSync(); await groupDialog('Saved after a landing');
  await holdLanding('Landing before a save');
  await submit(3); await expect(dialogButton(t('common.save'))).toBeDisabled();
  await finishLanding(); await noDialog();
  await expect(groupNamed('Saved after a landing')).toHaveCount(1);

  // An earlier click keeps its place: adjusting starts, and the editor behind it does not open under the overlay.
  await settled(); await holdSync(); await holdLanding('Landing under Adjust');
  await press('#operate-all'); await press('#add-group');
  assert.equal(await open(), 0, 'a click after Adjust must not open a dialog ahead of it');
  await finishLanding(); await expect.poll(adjusting).toBe(true);
  assert.equal(await open(), 0, 'the editor queued behind Adjust must not open under the overlay');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect.poll(adjusting).toBe(false);

  // So does a shortcut from a desktop window, which never passes through the main window: the dialog must not refuse it.
  await settled(); await holdSync(); await holdLanding('Landing under a shortcut');
  await command('queued-shortcut', 'interaction.shortcut', 3, { key: 'Ctrl+Shift+0' });
  await press('#add-group');
  assert.equal(await open(), 0, 'a click after a shortcut already in the queue must not open a dialog ahead of it');
  await finishLanding(); await accepted('queued-shortcut');
  await expect.poll(adjusting).toBe(true);
  assert.equal(await open(), 0, 'the editor behind a shortcut that started adjusting must not open under the overlay');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await expect.poll(adjusting).toBe(false);

  // A sync renaming the group under the dialog refuses the rename once; trying again, as the refusal says, succeeds.
  await settled(); await peerPull();
  const renamed = peer.workspace.snapshot.groups.find(group => group.name === 'First during sync');
  await holdSync();
  await page.locator('#groups .group-row[data-group-id]', { hasText: 'First during sync' }).locator('.group-menu').evaluate(node => node.click());
  await page.locator('dialog[open]').getByRole('textbox').fill('Named here');
  await peer.workspace.renameGroup(renamed.id, 'Renamed elsewhere', renamed.revision); await peerPull();
  await finishSync(); await expect(groupNamed('Renamed elsewhere')).toHaveCount(1);
  await submit(1); await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('errors.core.groupUpdated'));
  await expect(dialogButton(t('common.save'))).toBeEnabled();
  await submit(1); await noDialog();
  await expect(groupNamed('Named here')).toHaveCount(1);

  // Once a save is writing, Cancel and Escape leave the dialog until the outcome is known.
  await synced(); await expect(page.locator('#account')).toHaveAttribute('data-sync', /ok|pending/);
  await groupDialog('Written despite Cancel');
  await page.evaluate(() => { window.fixtureCommits = 0; window.fixtureCommitGate = new Promise(resolve => { window.fixtureOpenCommits = resolve; }); });
  await submit(1); await expect.poll(() => page.evaluate(() => window.fixtureCommits)).toBeGreaterThan(0);
  await press('dialog[open] .dialog-actions button:not([type=submit])'); await page.keyboard.press('Escape');
  assert.equal(await open(), 1, 'Cancel and Escape must not close a dialog whose save is writing');
  await page.evaluate(() => { window.fixtureOpenCommits(); window.fixtureCommitGate = undefined; });
  await noDialog();
  await expect(page.locator('.toast[data-latest=true] .toast-message')).toHaveText(t('app.status.groupSaved'));
  await expect(groupNamed('Written despite Cancel')).toHaveCount(1);

  // A failure needing a recovery question cannot ask over the dialog, so it asks when the dialog closes. Keep this last for
  // this page: it leaves the session blocked on that question.
  await settled();
  failHeld = 'dataset-changed'; await holdSync(); await press('#add-group'); release(); release = null;
  await expect(page.locator('#account')).toHaveAttribute('data-sync', 'attention');
  assert.equal(await open(), 1, 'the recovery question must not open over the group dialog');
  await dialogButton(t('common.cancel')).click();
  await expect(page.locator('#source-reset-dialog')).toHaveCount(1);
  await context.close();

  // The same question, for a failure under the main editor.
  const editing = await launch();
  failHeld = 'dataset-changed'; await holdSync('listDatasetChanges', editing.page);
  await editing.page.locator('#compose').click(); await expect(editing.page.locator('#editor-dialog')).toBeVisible();
  release(); release = null;
  await expect(editing.page.locator('#account')).toHaveAttribute('data-sync', 'attention');
  assert.equal(await editing.page.locator('#source-reset-dialog').count(), 0, 'the recovery question must not open over the editor');
  await editing.page.locator('#close-editor-button').click();
  await expect(editing.page.locator('#source-reset-dialog')).toHaveCount(1);
  await editing.context.close();

  // Closing the app during a sync ends it: the queue is free, and the stopped pass neither lands nor waits for anything.
  const closing = await launch();
  await holdSync('listDatasetChanges', closing.page); await closing.page.evaluate(() => window.fixtureClose());
  release(); release = null;
  await expect.poll(() => closing.page.evaluate(() => window.fixtureRequests.includes('host.closeReady'))).toBe(true);
  await closing.context.close();

  assert.deepEqual(errors, []);
  console.log(`PASS ${engine}: saving, Adjust and a quick edit finish while Drive has not answered and reach another device; click order, one press, withdrawal, landings under dialogs and closing all hold.`);
} finally { await browser.close(); }
