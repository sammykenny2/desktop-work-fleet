import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlatformVersion, versionRecords } from '../scripts/platform-version.mjs';
import { readReleaseEntry, releaseEntry, releaseNotesFile } from '../scripts/release-notes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = `# Release Notes

Preamble.

## 1.2.0

Platforms: Windows, Linux.

Summary: Adds a thing.

- Windows: one change.
- Another change.

## 1.1.0

Platforms: Windows.

Summary: Older.

- Old change.
`;

test('an entry yields its platforms, summary and change bullets', () => {
  assert.deepEqual(releaseEntry(sample, '1.2.0'), {
    version: '1.2.0', platforms: ['Windows', 'Linux'], summary: 'Adds a thing.', changes: '- Windows: one change.\n- Another change.',
  });
  assert.equal(releaseEntry(sample, '1.1.0').changes, '- Old change.');
});

test('a missing or malformed entry stops the release', () => {
  assert.throws(() => releaseEntry(sample, '1.3.0'), /no "## 1\.3\.0" entry/);
  assert.throws(() => releaseEntry(sample, '1.2'), /numeric/);
  assert.throws(() => releaseEntry(sample.replace('Summary: Adds a thing.\n', ''), '1.2.0'), /exactly one "Summary:"/);
  assert.throws(() => releaseEntry(sample.replace('Adds a thing.', 'x'.repeat(501)), '1.2.0'), /1-500 characters/);
  assert.throws(() => releaseEntry('## 1.0.0\n\nPlatforms: Linux.\n\nSummary: Only.\n', '1.0.0'), /no changes/);
});

test('every version recorded in the repository has release notes', async () => {
  // The version-bump commit writes the entry, so a bump without notes fails here before any release starts.
  for (const platform of Object.keys(versionRecords)) {
    const version = await readPlatformVersion(platform);
    const entry = await readReleaseEntry(version);
    assert.ok(entry.summary.length <= 500, `${platform} ${version}`);
  }
});

test('release notes describe changes, not publication status', async () => {
  const text = await readFile(path.join(root, releaseNotesFile), 'utf8');
  assert.doesNotMatch(text, /\b(published|prepared)\b/i);
  assert.doesNotMatch(text, /\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/);
});
