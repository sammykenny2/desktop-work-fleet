/** Desktop scene rendering regression with a synthetic host. Usage: node scripts/testing/scene-probe.mjs --url http://127.0.0.1:PORT */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { t } from '../../src/i18n/index.js';
import { catalogs } from '../../src/i18n/catalogs.js';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/scene-probe.mjs --url http://127.0.0.1:PORT\nLoads the built desktop scene with an in-page synthetic host and synthetic papers only.');
  process.exit(0);
}
const urlIndex = process.argv.indexOf('--url');
assert.ok(urlIndex >= 0 && process.argv[urlIndex + 1], '--url is required');
const base = new URL(process.argv[urlIndex + 1]);
assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only loopback development previews are allowed');
base.pathname = '/desktop/index.html';
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 }, locale: 'en-US' })).newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
// The host answers the scene's requests the way the native owners do: info, a chunked frame with its digest, applied.
// Each frame carries the owner's locale, as projectDesktop does.
await page.addInitScript(() => {
  const listeners = new Set(); const frames = new Map(); let sequence = 1;
  const send = data => setTimeout(() => listeners.forEach(listener => listener({ data })), 0);
  const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const paper = (id, x, summary, text, color) => ({ id, groupId: 'g1', revision: 'r1', summary, text, format: 'markdown', attachmentCount: 0,
    rect: { x, y: 24, width: 240, height: 240 }, layer: 'desktop', interactive: true, draggable: false, editing: false,
    selected: false, completed: false, mine: false, color });
  const frame = () => ({ protocol: 1, sessionId: 's1', sequence, topology: 0, locale: window.probeLocale || 'en', workspaceRevision: sequence, layoutRevision: sequence,
    groups: [{ id: 'g1', name: 'My notes', color: '#fff6cc', region: null }], operationScope: { kind: 'none' }, activeGroupId: 'g1',
    cards: window.probeLong ? [{ ...paper('long', 24, 'Long note', Array.from({ length: 30 }, (_, n) => `Line ${n + 1}, long enough to wrap on the paper.`).join('\n\n'), '#ffe98a'),
      rect: { x: 24, y: 24, width: 240, height: window.probeTall ? 480 : 240 }, interactive: !window.probeWallpaper,
      attachments: Array.from({ length: 6 }, (_, n) => ({ id: `blob-${n}`, name: `file-${n}.pdf` })) }] : window.probeRich ? [{ ...paper('rich', 24, 'Rich content', '# Section 1\n## Section 2\n### Section 3\n#### Section 4\n##### Section 5\n###### Section 6\n\n```js\nconst message = \"hello\";\n```\n\n```unknown-language\n<script>never execute</script>\n```\n\n- [ ] read only\n\n<img src=x onerror=alert(1)>', '#fff6cc'), revision: window.probeFileRevision || 'r1', rect: { x: 24, y: 24, width: 520, height: 500 }, draggable: true, attachments: [{ id: 'blob-a', name: 'proof.pdf' }, { id: 'blob-b', name: 'photo.png' }] }] : [
      { ...paper('c1', 24, 'Quarterly report', `# Quarterly report\n\n- [x] Collect the numbers\n- [ ] Draw the charts\n- [${sequence > 1 ? 'x' : ' '}] Write the summary`, '#fff6cc'),
        interactive: !window.probeClickThrough },
      paper('c2', 292, 'Buy milk, eggs and coffee beans', 'Buy milk, eggs and coffee beans', '#e7f2e7'),
      paper('c3', 560, sequence > 1 ? 'Dentist moved' : 'Dentist appointment', `# ${sequence > 1 ? 'Dentist moved' : 'Dentist appointment'}\n\nNext Tuesday at 14:30, bring the insurance card.`, '#e5edf8'),
    ], editor: null, dropTarget: null, fallbacks: [], notice: null, quickMove: window.probeQuick || null });
  window.probeApplied = 0; window.probeCommands = []; window.probeChecks = []; window.probePointer = [];
  window.probeNextFrame = () => { sequence++; send({ v: 1, event: 'desktop-frame' }); };
  const handle = async message => {
    const reply = result => send({ v: 1, id: message.id, ok: true, result });
    if (message.method === 'scene.info') return reply({ sessionId: 's1', viewId: 'v1', layer: 'desktop', viewport: { x: 0, y: 0, width: 900, height: 560 }, bindings: {} });
    if (message.method === 'scene.frame') {
      const bytes = new TextEncoder().encode(JSON.stringify(frame())); const token = `t${sequence}`; frames.set(token, bytes);
      return reply({ token, size: bytes.length, sha256: await hex(bytes) });
    }
    if (message.method === 'scene.read') {
      const { token, offset } = message.params; const bytes = frames.get(token); const chunk = bytes.subarray(offset, offset + 256 * 1024);
      return reply({ offset, base64: btoa(String.fromCharCode(...chunk)), done: offset + chunk.length === bytes.length });
    }
    if (message.method === 'scene.command') {
      const command = message.params.command; window.probeCommands.push(command.method);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96; const paint = canvas.getContext('2d'); paint.fillStyle = command.args.attachmentId === 'blob-a' ? '#e7edf8' : '#e7f2e7'; paint.fillRect(0, 0, 96, 96); paint.fillStyle = '#245f50'; paint.font = 'bold 22px sans-serif'; paint.textAlign = 'center'; paint.fillText(command.args.attachmentId === 'blob-a' ? 'PDF' : 'PNG', 48, 56);
      // Pointer gestures are accepted as the owner accepts a quick move, and recorded with their arguments.
      const result = command.method === 'attachment.preview' ? { available: !window.probeMissing, png: window.probeMissing ? null : canvas.toDataURL('image/png').split(',')[1] }
        : command.method === 'pointer.down' ? { accepted: true } : command.method === 'pointer.up' ? { kind: 'moved' }
        : command.method === 'pointer.move' && window.probeDropMove ? { kind: 'cancelled', reason: 'quick-move-ended' } : { opened: true };
      if (command.method.startsWith('pointer.')) window.probePointer.push({ method: command.method, args: command.args });
      if (command.method === 'card.check') window.probeChecks.push(command.args);
      if (command.method === 'card.check' && window.probeRefuseCheck) send({ v: 1, event: 'desktop-command-result', commandId: command.id, ok: false, error: { code: 'desktop-expired', message: 'The note has changed.' } });
      else send({ v: 1, event: 'desktop-command-result', commandId: command.id, ok: true, result });
    }
    if (message.method === 'scene.applied') window.probeApplied++;
    return reply({});
  };
  window.chrome = { webview: { postMessage: message => { void handle(message); },
    addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener) } };
});
const read = () => page.evaluate(() => ({
  status: document.querySelector('#scene-status').hidden ? null : document.querySelector('#scene-status').textContent,
  summaries: [...document.querySelectorAll('.card-summary')].map(node => node.textContent),
  bodies: [...document.querySelectorAll('.card-body')].map(node => node.textContent.trim()),
  headings: document.querySelectorAll('.card-body h1').length,
  bulletedSteps: [...document.querySelectorAll('.card-body li')].filter(li => li.querySelector('input') && getComputedStyle(li).listStyleType !== 'none').length,
  steps: [...document.querySelectorAll('.card-body input')].map(input => input.checked),
  square: [...document.querySelectorAll('.card')].every(node => node.offsetWidth === node.offsetHeight),
}));
// The scene's own text: document language, title, landmark label and the first paper button.
const texts = () => page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title,
  label: document.querySelector('#scene').getAttribute('aria-label'), edit: document.querySelector('.card-actions button')?.textContent ?? null }));
try {
  await page.goto(base.href);
  await page.waitForFunction(() => window.probeApplied === 1);
  const first = await read();
  assert.equal(first.status, null);
  assert.deepEqual(await texts(), { lang: 'en', title: t('desktop.scene.title'), label: t('desktop.scene.label'), edit: null });
  assert.deepEqual(first.summaries, ['Quarterly report', 'Buy milk, eggs and coffee beans', 'Dentist appointment']);
  // The body shows the whole text from its first line, even where the band already shows that line.
  assert.equal(first.bodies[1], 'Buy milk, eggs and coffee beans', 'a one-line note fills its body, not only its band');
  assert.match(first.bodies[2], /^Dentist appointment\s+Next Tuesday at 14:30, bring the insurance card\.$/);
  assert.equal(first.headings, 2); assert.equal(first.bulletedSteps, 0, 'checklist steps show a box, not a bullet');
  assert.deepEqual(first.steps, [true, false, false]); assert.ok(first.square);
  // A paper that takes clicks ticks a step through the owner, without selecting, dragging or editing it, and its boxes
  // wait for the frame that draws the saved text.
  const boxes = page.locator('.card[data-card-id="c1"] .card-body input');
  const boxState = () => boxes.evaluateAll(nodes => nodes.map(node => ({ checked: node.checked, disabled: node.disabled })));
  assert.deepEqual((await boxState()).map(box => box.disabled), [false, false, false]);
  await boxes.nth(1).click();
  await page.waitForFunction(() => window.probeChecks.length === 1);
  assert.deepEqual(await page.evaluate(() => window.probeChecks[0]), { cardId: 'c1', revision: 'r1', task: 1 });
  assert.deepEqual((await boxState()).map(box => box.disabled), [true, true, true], 'ticked boxes wait for the saved text');
  assert.equal(await page.evaluate(() => window.probeCommands.some(method => method.startsWith('pointer.') || ['card.edit', 'card.select'].includes(method))), false,
    'ticking never selects, drags or edits the paper');
  // A later frame reuses each paper's nodes; the title and the steps must follow without a scene error.
  await page.evaluate(() => window.probeNextFrame());
  await page.waitForFunction(() => window.probeApplied === 2 || !document.querySelector('#scene-status').hidden);
  const second = await read();
  assert.equal(second.status, null, 'the second frame renders without a scene error');
  assert.deepEqual(second.summaries, ['Quarterly report', 'Buy milk, eggs and coffee beans', 'Dentist moved']);
  assert.deepEqual(second.steps, [true, false, true]); assert.match(second.bodies[2], /^Dentist moved\s/);
  // A refused tick puts the box back and says why.
  assert.deepEqual((await boxState()).map(box => box.disabled), [false, false, false], 'the next frame takes ticks again');
  await page.evaluate(() => { window.probeRefuseCheck = true; });
  await boxes.nth(0).click();
  await page.waitForFunction(() => !document.querySelector('#scene-status').hidden);
  assert.deepEqual(await boxState(), [{ checked: true, disabled: false }, { checked: false, disabled: false }, { checked: true, disabled: false }]);
  await page.evaluate(() => { window.probeRefuseCheck = false; });
  // The same text on a paper that stops taking clicks is drawn again with read-only boxes, and again when it takes them.
  await page.evaluate(() => { window.probeClickThrough = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 3);
  assert.deepEqual((await boxState()).map(box => box.disabled), [true, true, true], 'a click-through paper draws read-only boxes');
  await page.evaluate(() => { window.probeClickThrough = false; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 4);
  assert.deepEqual((await boxState()).map(box => box.disabled), [false, false, false]);
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe.png' });
  await page.evaluate(() => { window.probeRich = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 5);
  await page.waitForFunction(() => [...document.querySelectorAll('.attachment-tile img')].length === 2 && [...document.querySelectorAll('.attachment-tile img')].every(img => img.complete && img.naturalWidth));
  const rich = await page.evaluate(() => ({
    headings: [1, 2, 3, 4, 5, 6].map(level => parseFloat(getComputedStyle(document.querySelector('.card-body h' + level)).fontSize)),
    keyword: getComputedStyle(document.querySelector('.hljs-keyword')).color,
    string: getComputedStyle(document.querySelector('.hljs-string')).color,
    disabled: document.querySelector('.card-body input').disabled,
    unknown: document.querySelectorAll('.card-body pre code')[1].textContent,
    unsafe: document.querySelectorAll('.card-body script,.card-body img:not(.attachment-tile img)').length,
  }));
  assert.ok(rich.headings.every((value, index) => index === 0 || value < rich.headings[index - 1]), 'six explicit heading sizes decrease');
  assert.notEqual(rich.keyword, rich.string); assert.equal(rich.disabled, false, 'a paper that takes clicks can tick its steps');
  assert.equal(rich.unknown.trim(), '<script>never execute</script>'); assert.equal(rich.unsafe, 0);
  // An adjusted paper's checkbox ticks without starting a drag on the paper beneath it.
  await page.locator('.card-body input').first().click();
  await page.waitForFunction(() => window.probeChecks.length === 3);
  assert.deepEqual(await page.evaluate(() => window.probeChecks[2]), { cardId: 'rich', revision: 'r1', task: 0 });
  await page.locator('.attachment-tile').first().dblclick();
  await page.waitForFunction(() => window.probeCommands.filter(method => method === 'attachment.open').length === 1);
  await page.locator('.attachment-tile').last().focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.probeCommands.filter(method => method === 'attachment.open').length === 2);
  assert.equal(await page.evaluate(() => window.probeCommands.includes('card.edit') || window.probeCommands.includes('pointer.down')), false, 'attachment gestures and ticks never edit or drag the paper');
  await page.screenshot({ path: 'build/rich-content-probe.png' });
  await page.evaluate(() => { document.querySelector('.card-body').scrollTop = 0; });
  await page.screenshot({ path: 'build/rich-headings-probe.png' });
  await page.evaluate(() => { window.probeMissing = true; window.probeFileRevision = 'r2'; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 6 && document.querySelectorAll('.attachment-tile.missing').length === 2);
  await page.evaluate(() => { window.probeMissing = false; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 7 && document.querySelectorAll('.attachment-tile img').length === 2);
  // A long paper that takes the mouse scrolls its text and shows no "…". On the wallpaper layer it cannot scroll, so it
  // shows what fits and ends with "…", fitting again when it grows and dropping the "…" once it scrolls again. Either
  // way its attachments are one row below the text, and tiles past that row are hidden.
  const fitted = () => page.evaluate(async () => {
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const body = document.querySelector('.card-body'); const files = document.querySelector('.paper-files');
    const range = document.createRange(); range.selectNodeContents(body);
    const textBottom = Math.max(...[...range.getClientRects()].map(rect => rect.bottom));
    return { overflow: getComputedStyle(body).overflowY, scrolls: body.scrollHeight > body.clientHeight + 1,
      tilesInBody: body.querySelectorAll('.attachment-tile').length,
      rowBelow: files.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 0.5,
      tiles: files.children.length, shownTiles: [...files.children].filter(tile => getComputedStyle(tile).visibility !== 'hidden').length,
      ends: body.querySelector('.fit-lines, .fit-more') !== null, inside: textBottom <= body.getBoundingClientRect().bottom + 0.5,
      shown: body.innerText.replace(/\s+/g, '').length };
  });
  const row = { tilesInBody: 0, rowBelow: true, tiles: 6, shownTiles: 4 };
  await page.evaluate(() => { window.probeLong = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 8);
  const scrolling = await fitted();
  assert.deepEqual({ ...scrolling, shown: undefined, inside: undefined },
    { overflow: 'auto', scrolls: true, ...row, ends: false, shown: undefined, inside: undefined });
  await page.evaluate(() => { window.probeWallpaper = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 9);
  const square = await fitted();
  assert.deepEqual({ ...square, shown: undefined }, { overflow: 'hidden', scrolls: false, ...row, ends: true, inside: true, shown: undefined });
  await page.screenshot({ path: 'build/fitted-paper-probe.png' });
  await page.evaluate(() => { window.probeTall = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 10);
  const tall = await fitted();
  assert.ok(tall.ends && tall.inside && tall.shown > square.shown * 2, `a taller paper shows more (${square.shown} → ${tall.shown})`);
  await page.evaluate(() => { window.probeTall = false; window.probeWallpaper = false; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 11);
  const again = await fitted();
  assert.ok(again.overflow === 'auto' && again.scrolls && !again.ends, 'a paper that takes the mouse again scrolls without "…"');
  // A frame in another locale switches the scene's own text before it draws; the next English frame switches it back.
  await page.evaluate(() => { window.probeLong = false; window.probeLocale = 'zh-TW'; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 12);
  const zh = catalogs['zh-TW'];
  assert.deepEqual(await texts(), { lang: 'zh-TW', title: zh['desktop.scene.title'], label: zh['desktop.scene.label'], edit: zh['desktop.card.edit'] });
  await page.evaluate(() => { window.probeLocale = 'en'; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 13);
  assert.deepEqual(await texts(), { lang: 'en', title: t('desktop.scene.title'), label: t('desktop.scene.label'), edit: t('desktop.card.edit') });
  // Quick move: with the frame's key held at the press, a resting paper drags through the owner and its text is not
  // selected. Without the key, or with quick move off, the same drag selects text and sends no gesture; a checkbox
  // still ticks. The key is the platform's: Command on macOS, Ctrl elsewhere.
  const [quickKey, quickModifier] = process.platform === 'darwin' ? ['meta', 'Meta'] : ['ctrl', 'Control'];
  const drag = async (selector, modifier) => {
    // Along the first line of text, where a plain drag selects.
    const box = await page.locator(selector).first().boundingBox(); const x = box.x + 4; const y = box.y + 8;
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 146, y, { steps: 10 }); await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
  };
  const quickState = () => page.evaluate(() => ({ downs: window.probePointer.filter(entry => entry.method === 'pointer.down').map(entry => entry.args),
    ups: window.probePointer.filter(entry => entry.method === 'pointer.up').length, selected: getSelection().toString().length > 0 }));
  await page.evaluate(quick => { window.probeRich = false; window.probeQuick = quick; window.probeNextFrame(); }, quickKey);
  await page.waitForFunction(() => window.probeApplied === 14);
  await drag('.card[data-card-id="c3"] .card-body p');
  let quick = await quickState();
  assert.deepEqual([quick.downs.length, quick.selected], [0, true], 'a drag without the key selects text and moves nothing');
  await page.evaluate(() => getSelection().removeAllRanges());
  await drag('.card[data-card-id="c3"] .card-body p', quickModifier);
  // The gesture ends once the owner has answered the release.
  await page.waitForFunction(() => window.probePointer.some(entry => entry.method === 'pointer.up') && !document.querySelector('#scene').classList.contains('moving'));
  quick = await quickState();
  assert.equal(quick.downs.length, 1); assert.equal(quick.downs[0].cardId, 'c3'); assert.equal(quick.downs[0].quick, true);
  assert.equal(quick.ups, 1); assert.equal(quick.selected, false, 'a quick move selects no text');
  assert.ok(await page.evaluate(() => window.probePointer.some(entry => entry.method === 'pointer.move')), 'the drag reaches the owner');
  // A quick move the owner ends mid-drag stops in the scene without an error and without a release command.
  await page.evaluate(() => { window.probeDropMove = true; });
  await drag('.card[data-card-id="c3"] .card-body p', quickModifier);
  await page.waitForFunction(() => window.probePointer.filter(entry => entry.method === 'pointer.down').length === 2 && !document.querySelector('#scene').classList.contains('moving'));
  assert.equal((await quickState()).ups, 1, 'an ended quick move sends no release');
  assert.equal(await page.evaluate(() => document.querySelector('#scene-status').hidden), true, 'an ended quick move shows no error');
  await page.evaluate(() => { window.probeDropMove = false; });
  await page.keyboard.down(quickModifier); await page.locator('.card[data-card-id="c1"] .card-body input').nth(1).click(); await page.keyboard.up(quickModifier);
  await page.waitForFunction(() => window.probeChecks.length === 4);
  assert.equal((await quickState()).downs.length, 2, 'a checkbox keeps ticking with the key held');
  // Each refresh after a gesture applies its frame again, so wait for one more than now.
  const appliedBefore = await page.evaluate(() => window.probeApplied);
  await page.evaluate(() => { window.probeQuick = null; window.probeNextFrame(); });
  await page.waitForFunction(count => window.probeApplied > count, appliedBefore);
  await drag('.card[data-card-id="c2"] .card-body p', quickModifier);
  assert.equal((await quickState()).downs.length, 2, 'with quick move off the key does nothing');
  const budgets = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/app/markdown.js');
    const element = document.createElement('div');
    const many = Array.from({ length: 80 }, (_, index) => '```js\nconst value' + index + ' = 42;\n```').join('\n\n');
    renderMarkdown(element, many);
    const coloured = element.querySelectorAll('pre:has(.hljs-keyword)').length;
    const long = Array.from({ length: 80 }, () => '```js\nconst value = "' + 'a'.repeat(2000) + '";\n```').join('\n\n');
    renderMarkdown(element, long);
    return { coloured, blocks: element.querySelectorAll('pre').length, spans: element.querySelectorAll('span').length,
      characters: element.textContent.length };
  });
  assert.ok(budgets.coloured > 0 && budgets.coloured <= 12, 'many small blocks have bounded highlighting work');
  assert.equal(budgets.blocks, 80); assert.equal(budgets.spans, 0);
  assert.ok(budgets.characters > 160000, 'large documents retain all code as plain text');
  assert.deepEqual(errors, []);
  console.log('PASS: desktop scene reuse, title band, scrolling text, … on the wallpaper layer refitted on resize, one row of attachments below the text, six heading sizes, code colours/escaping/budgets, ticking checklists only where papers take clicks, quick move only with the key held and the setting on, attachment PNG thumbnails and missing-file sync refresh, double-click and keyboard open without dragging/editing, scene text following the frame locale');
} catch (error) {
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe-failure.png' });
  if (errors.length) console.error('Scene page errors:', errors);
  throw error;
} finally { await browser.close(); }
