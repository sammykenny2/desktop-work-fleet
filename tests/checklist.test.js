import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, toggleChecklist } from '../src/app/checklist.js';

test('task toggle changes one parsed checkbox, preserving code and escaped lookalikes', () => {
  const source = '```md\n- [ ] fake\n```\n\n- [ ] first\n  - [X] nested\n\n> - [ ] quoted\n\n\\[ ] literal';
  assert.equal(toggleChecklist(source, 0), source.replace('- [ ] first', '- [x] first'));
  assert.equal(toggleChecklist(source, 1), source.replace('- [X] nested', '- [ ] nested'));
  assert.equal(toggleChecklist(source, 2), source.replace('> - [ ] quoted', '> - [x] quoted'));
});

test('duplicate task text still toggles the chosen task', () => {
  assert.equal(toggleChecklist('- [ ] same\n- [ ] same', 1), '- [ ] same\n- [x] same');
  assert.throws(() => toggleChecklist('no tasks', 0), error => error.code === 'missing-task');
});

test('raw HTML is text, so it cannot masquerade as generated GFM checkboxes', () => {
  const html = markdown.parse('<input type="checkbox">\n\n- [ ] real task\n\n<script>globalThis.changed = true</script>');
  assert.ok(html.includes('&lt;input'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal((html.match(/<input/g) || []).length, 1);
});
