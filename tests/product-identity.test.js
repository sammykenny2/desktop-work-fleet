import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
// Keep the retired identity only as a search pattern, never as a runtime alias or default.
const retired = new RegExp(['work', 'fleet'].join('[\\s_.-]*'), 'i');
const historical = file => file === 'docs/release-notes.md'
  || /^docs\/(decisions|handoff|plans|research)\//.test(file)
  || /^docs\/validation\/\d{4}-\d{2}-\d{2}-.*\.md$/.test(file);

test('current source, filenames, assets and configuration contain only the current product identity', () => {
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
    .toString('utf8').split('\0').filter(Boolean))];
  const failures = [];
  for (const file of files) {
    const target = path.join(root, file);
    if (!existsSync(target) || !lstatSync(target).isFile()) continue;
    if (retired.test(file)) failures.push(`${file}: filename`);
    if (historical(file)) continue;
    // ASCII identity markers are searchable in binary assets as well as UTF-8 source.
    if (retired.test(readFileSync(target).toString('utf8'))) failures.push(`${file}: content`);
  }
  assert.deepEqual(failures, []);
});
