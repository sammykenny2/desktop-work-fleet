/** Desktop scene rendering regression with a synthetic host. Usage: node scripts/testing/scene-probe.mjs --url http://127.0.0.1:PORT */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

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
const page = await (await browser.newContext({ viewport: { width: 900, height: 560 } })).newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
// The host answers the scene's requests the way the native owners do: info, a chunked frame with its digest, applied.
await page.addInitScript(() => {
  const listeners = new Set(); const frames = new Map(); let sequence = 1;
  const send = data => setTimeout(() => listeners.forEach(listener => listener({ data })), 0);
  const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const paper = (id, x, summary, text, color) => ({ id, groupId: 'g1', revision: 'r1', summary, text, format: 'markdown', attachmentCount: 0,
    rect: { x, y: 24, width: 240, height: 240 }, layer: 'desktop', interactive: true, draggable: false, editing: false,
    selected: false, completed: false, mine: false, color });
  const frame = () => ({ protocol: 1, sessionId: 's1', sequence, topology: 0, workspaceRevision: sequence, layoutRevision: sequence,
    groups: [{ id: 'g1', name: '我的便箋', color: '#fff6cc', region: null }], operationScope: { kind: 'none' }, activeGroupId: 'g1',
    cards: window.probeRich ? [{ ...paper('rich', 24, 'Rich content', '# Section 1\n## Section 2\n### Section 3\n#### Section 4\n##### Section 5\n###### Section 6\n\n```js\nconst message = \"hello\";\n```\n\n```unknown-language\n<script>never execute</script>\n```\n\n- [ ] read only\n\n<img src=x onerror=alert(1)>', '#fff6cc'), revision: window.probeFileRevision || 'r1', rect: { x: 24, y: 24, width: 520, height: 500 }, draggable: true, attachments: [{ id: 'blob-a', name: 'proof.pdf' }, { id: 'blob-b', name: 'photo.png' }] }] : [
      paper('c1', 24, '季度報告', `# 季度報告\n\n- [x] 收集數字\n- [ ] 畫圖表\n- [${sequence > 1 ? 'x' : ' '}] 寫結論`, '#fff6cc'),
      paper('c2', 292, '買牛奶、雞蛋、咖啡豆', '買牛奶、雞蛋、咖啡豆', '#e7f2e7'),
      paper('c3', 560, sequence > 1 ? '牙醫改期' : '牙醫預約', `# ${sequence > 1 ? '牙醫改期' : '牙醫預約'}\n\n下週二 14:30，記得帶健保卡。`, '#e5edf8'),
    ], editor: null, dropTarget: null, fallbacks: [], notice: null });
  window.probeApplied = 0; window.probeCommands = [];
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
      const result = command.method === 'attachment.preview' ? { available: !window.probeMissing, png: window.probeMissing ? null : canvas.toDataURL('image/png').split(',')[1] } : { opened: true };
      send({ v: 1, event: 'desktop-command-result', commandId: command.id, ok: true, result });
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
try {
  await page.goto(base.href);
  await page.waitForFunction(() => window.probeApplied === 1);
  const first = await read();
  assert.equal(first.status, null);
  assert.deepEqual(first.summaries, ['季度報告', '買牛奶、雞蛋、咖啡豆', '牙醫預約']);
  // The body shows the whole text from its first line, even where the band already shows that line.
  assert.equal(first.bodies[1], '買牛奶、雞蛋、咖啡豆', 'a one-line note fills its body, not only its band');
  assert.match(first.bodies[2], /^牙醫預約\s+下週二 14:30，記得帶健保卡。$/);
  assert.equal(first.headings, 2); assert.equal(first.bulletedSteps, 0, 'checklist steps show a box, not a bullet');
  assert.deepEqual(first.steps, [true, false, false]); assert.ok(first.square);
  // A later frame reuses each paper's nodes; the title and the steps must follow without a scene error.
  await page.evaluate(() => window.probeNextFrame());
  await page.waitForFunction(() => window.probeApplied === 2 || !document.querySelector('#scene-status').hidden);
  const second = await read();
  assert.equal(second.status, null, 'the second frame renders without a scene error');
  assert.deepEqual(second.summaries, ['季度報告', '買牛奶、雞蛋、咖啡豆', '牙醫改期']);
  assert.deepEqual(second.steps, [true, false, true]); assert.match(second.bodies[2], /^牙醫改期\s/);
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe.png' });
  await page.evaluate(() => { window.probeRich = true; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.attachment-tile img')].length === 2 && [...document.querySelectorAll('.attachment-tile img')].every(img => img.complete && img.naturalWidth));
  const rich = await page.evaluate(() => ({
    headings: [1, 2, 3, 4, 5, 6].map(level => parseFloat(getComputedStyle(document.querySelector('.card-body h' + level)).fontSize)),
    keyword: getComputedStyle(document.querySelector('.hljs-keyword')).color,
    string: getComputedStyle(document.querySelector('.hljs-string')).color,
    disabled: document.querySelector('.card-body input').disabled,
    unknown: document.querySelectorAll('.card-body pre')[1].textContent,
    unsafe: document.querySelectorAll('.card-body script,.card-body img:not(.attachment-tile img)').length,
  }));
  assert.ok(rich.headings.every((value, index) => index === 0 || value < rich.headings[index - 1]), 'six explicit heading sizes decrease');
  assert.notEqual(rich.keyword, rich.string); assert.equal(rich.disabled, true);
  assert.equal(rich.unknown.trim(), '<script>never execute</script>'); assert.equal(rich.unsafe, 0);
  await page.locator('.attachment-tile').first().dblclick();
  await page.waitForFunction(() => window.probeCommands.filter(method => method === 'attachment.open').length === 1);
  await page.locator('.attachment-tile').last().focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.probeCommands.filter(method => method === 'attachment.open').length === 2);
  assert.equal(await page.evaluate(() => window.probeCommands.includes('card.edit') || window.probeCommands.includes('pointer.down')), false, 'attachment gestures never edit or drag the paper');
  await page.screenshot({ path: 'build/rich-content-probe.png' });
  await page.evaluate(() => { document.querySelector('.card-body').scrollTop = 0; });
  await page.screenshot({ path: 'build/rich-headings-probe.png' });
  await page.evaluate(() => { window.probeMissing = true; window.probeFileRevision = 'r2'; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 4 && document.querySelectorAll('.attachment-tile.missing').length === 2);
  await page.evaluate(() => { window.probeMissing = false; window.probeNextFrame(); });
  await page.waitForFunction(() => window.probeApplied === 5 && document.querySelectorAll('.attachment-tile img').length === 2);
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
  console.log('PASS: desktop scene reuse, title band, six heading sizes, code colours/escaping/budgets, read-only checklists, attachment PNG thumbnails and missing-file sync refresh, double-click and keyboard open without dragging/editing');
} catch (error) {
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe-failure.png' });
  if (errors.length) console.error('Scene page errors:', errors);
  throw error;
} finally { await browser.close(); }
