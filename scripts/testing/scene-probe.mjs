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
    cards: [
      paper('c1', 24, '季度報告', `# 季度報告\n\n- [x] 收集數字\n- [ ] 畫圖表\n- [${sequence > 1 ? 'x' : ' '}] 寫結論`, '#fff6cc'),
      paper('c2', 292, '買牛奶、雞蛋、咖啡豆', '買牛奶、雞蛋、咖啡豆', '#e7f2e7'),
      paper('c3', 560, sequence > 1 ? '牙醫改期' : '牙醫預約', `# ${sequence > 1 ? '牙醫改期' : '牙醫預約'}\n\n下週二 14:30，記得帶健保卡。`, '#e5edf8'),
    ], editor: null, dropTarget: null, fallbacks: [], notice: null });
  window.probeApplied = 0;
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
  repeatedTitles: document.querySelectorAll('.card-body h1').length,
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
  assert.deepEqual(first.bodies.slice(1), ['', '下週二 14:30，記得帶健保卡。'], 'a body does not repeat the title in the band');
  assert.equal(first.repeatedTitles, 0); assert.equal(first.bulletedSteps, 0, 'checklist steps show a box, not a bullet');
  assert.deepEqual(first.steps, [true, false, false]); assert.ok(first.square);
  // A later frame reuses each paper's nodes; the title and the steps must follow without a scene error.
  await page.evaluate(() => window.probeNextFrame());
  await page.waitForFunction(() => window.probeApplied === 2 || !document.querySelector('#scene-status').hidden);
  const second = await read();
  assert.equal(second.status, null, 'the second frame renders without a scene error');
  assert.deepEqual(second.summaries, ['季度報告', '買牛奶、雞蛋、咖啡豆', '牙醫改期']);
  assert.deepEqual(second.steps, [true, false, true]); assert.equal(second.repeatedTitles, 0);
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: desktop scene frames, title band without a repeated body title, checklist boxes, square papers and node reuse');
} catch (error) {
  await mkdir('build', { recursive: true }); await page.screenshot({ path: 'build/scene-probe-failure.png' });
  if (errors.length) console.error('Scene page errors:', errors);
  throw error;
} finally { await browser.close(); }
