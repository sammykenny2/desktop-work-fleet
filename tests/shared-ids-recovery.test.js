import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { t } from '../src/i18n/index.js';

const source = await readFile(new URL('../src/app/main.js', import.meta.url), 'utf8');
const landing = source.slice(source.indexOf('function landSync(receive)'), source.indexOf('// A backup refuses a snapshot'));
const runner = source.slice(source.indexOf('async function run(action'), source.indexOf('function primaryArea('));

function fixture(queued) {
  const dialogs = []; const errors = []; let reloaded = 0; let failing = true; let saved = null; let tail = Promise.resolve();
  const element = (tag, text) => ({ tag, textContent: text, children: [], style: {}, append(...children) { this.children.push(...children); },
    addEventListener() {}, setAttribute() {}, showModal() { this.open = true; dialogs.push(this); }, close() { this.open = false; }, remove() {} });
  const currentDraft = { content: { title: 'Unwritten title', text: 'Latest unsaved text' } };
  const context = vm.createContext({
    t, element, currentDraft, remoteEditor: null, nativeClosing: false, accountBusy: false, sharedIdsBlocked: false,
    stopAutomatic: null, stopCompanionBackups() {}, activeActions: new Set(), syncBusy: false, maintenanceWork: null,
    document: { documentElement: { inert: false }, body: { append() {} } }, location: { reload() { reloaded++; } },
    desktop: queued ? { perform(action) { const pending = tail.then(action); tail = pending.catch(() => {}); return pending; } } : null,
    workspace: { sharedIds: () => ['colliding-id'], pendingCount: 0 },
    status: message => errors.push(message), adjustOverlayActive: () => false, syncGoogle() {},
    immediateButton: (text, action) => ({ tag: 'button', textContent: text, onclick: action }),
    flushDraft: async () => { if (failing) throw new Error('Disk full'); saved = structuredClone(currentDraft); },
  });
  vm.runInContext(`${landing}\n${runner}`, context);
  const nodes = root => [root, ...root.children?.flatMap(nodes) ?? []];
  return { context, dialogs, errors, nodes, recover: () => context.landSync(async () => 'received'),
    reloads: () => reloaded, saved: () => saved, allowSave: () => { failing = false; } };
}

for (const queued of [false, true]) {
  test(`a failed collision flush keeps text and retries before reopening (${queued ? 'desktop queue' : 'handheld'})`, { timeout: 3000 }, async () => {
    const f = fixture(queued);
    assert.equal(await f.recover(), 'received');
    assert.equal(f.reloads(), 0, 'failed saves must not discard the page');
    assert.equal(f.saved(), null);
    const dialog = f.dialogs[0]; assert.equal(dialog.open, true);
    const text = f.nodes(dialog).find(node => node.tag === 'textarea');
    assert.equal(text.readOnly, true); assert.equal(text.value, 'Unwritten title\n\nLatest unsaved text');
    assert.equal(f.context.document.documentElement.inert, false, 'the recovery controls remain usable');
    let ran = false; await f.context.run(() => { ran = true; });
    assert.equal(ran, false, 'ordinary writes stay blocked while ids are ambiguous');
    const retry = f.nodes(dialog).find(node => node.tag === 'button');
    await retry.onclick(); assert.equal(f.reloads(), 0, 'a second failure remains recoverable');
    assert.equal(retry.disabled, false);
    f.allowSave(); await retry.onclick();
    assert.equal(f.saved().content.text, 'Latest unsaved text'); assert.equal(f.reloads(), 1);
    assert.equal(dialog.open, false);
  });
}

test('a successful collision flush reopens only after the save completes', async () => {
  const f = fixture(false); f.allowSave();
  await f.recover();
  assert.equal(f.saved().content.text, 'Latest unsaved text'); assert.equal(f.reloads(), 1); assert.equal(f.dialogs.length, 0);
});

test('a paused collision still saves its owned draft and acknowledges the native background lifecycle', async () => {
  const f = fixture(false); await f.recover(); f.allowSave();
  const calls = []; let background;
  Object.assign(f.context, { automatic: null, companionBackupsIdle: async () => {},
    native: { bridge: { onEvent(_type, listener) { background = listener; }, request: async (...args) => calls.push(args) } } });
  const listener = source.slice(source.indexOf("native.bridge.onEvent('host-background'"), source.indexOf("native.bridge.onEvent('host-foreground'"));
  vm.runInContext(listener, f.context); background({ id: 'background-task' });
  await Promise.all([...f.context.activeActions]);
  assert.equal(f.saved().content.text, 'Latest unsaved text');
  assert.equal(calls[0][0], 'host.backgroundReady'); assert.equal(calls[0][1].id, 'background-task');
  assert.equal(f.reloads(), 0, 'background saving does not navigate away from the recovery dialog');
});
