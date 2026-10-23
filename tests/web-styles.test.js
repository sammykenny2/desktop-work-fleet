import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheets = ['src/app/style.css', 'src/app/rich-content.css', 'src/desktop/scene.css'];

// iOS and macOS WebKit, and WebKitGTK, may honour only the prefixed property, so every rule names both.
test('every user-select rule also sets -webkit-user-select to the same value', () => {
  for (const sheet of sheets) {
    const css = readFileSync(sheet, 'utf8');
    for (const rule of css.match(/[^{}]+\{[^{}]*\}/g) || []) {
      const plain = [...rule.matchAll(/(?<![-\w])user-select:\s*([\w-]+)/g)].map(match => match[1]);
      const prefixed = [...rule.matchAll(/-webkit-user-select:\s*([\w-]+)/g)].map(match => match[1]);
      assert.deepEqual(prefixed, plain, `${sheet}: ${rule.trim().slice(0, 80)}`);
    }
  }
});

test('a finger held on the sidebar brings up no text selection or callout', () => {
  const sidebar = readFileSync('src/app/style.css', 'utf8').match(/\.sidebar\{[^}]*\}/)[0];
  for (const declaration of ['user-select:none', '-webkit-user-select:none', '-webkit-touch-callout:none']) {
    assert.ok(sidebar.includes(declaration), declaration);
  }
});
