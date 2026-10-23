import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeUpdateFeed } from '../scripts/macos/write-update-feed.mjs';

// ADR-044: the vX.Y.Z release carries a Sparkle appcast for the macOS archive and the macOS update manifest.
test('macOS release feed names the archive in the vX.Y.Z release with the sign_update signature', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'work-fleet-feed-'));
  try {
    const archive = path.join(folder, 'WorkFleet-0.2.0-macos-universal.zip'); const bytes = Buffer.from('signed app archive');
    await writeFile(archive, bytes);
    const signature = `sparkle:edSignature="${'A'.repeat(86)}==" length="${bytes.length}"`;
    const { manifest } = await writeUpdateFeed({ archive, signature, version: '0.2.0', build: '200', repository: 'o/r', output: folder,
      summary: 'Fixes <bugs> & improvements', now: new Date('2026-10-14T00:00:00Z') });
    const appcast = await readFile(path.join(folder, 'appcast.xml'), 'utf8');
    assert.match(appcast, /<sparkle:version>200<\/sparkle:version>/);
    assert.match(appcast, /<sparkle:shortVersionString>0\.2\.0<\/sparkle:shortVersionString>/);
    assert.match(appcast, /url="https:\/\/github\.com\/o\/r\/releases\/download\/v0\.2\.0\/WorkFleet-0\.2\.0-macos-universal\.zip"/);
    assert.match(appcast, new RegExp(`length="${bytes.length}" type="application/octet-stream" sparkle:edSignature="A{86}=="`));
    assert.match(appcast, /<description>Fixes &lt;bugs&gt; &amp; improvements<\/description>/);
    const { manifestNames } = JSON.parse(await readFile(new URL('./fixtures/update-feed.json', import.meta.url), 'utf8'));
    assert.deepEqual(JSON.parse(await readFile(path.join(folder, manifestNames.macos), 'utf8')), manifest);
    assert.deepEqual(manifest, { schemaVersion: 1, platform: 'macos', version: '0.2.0', tag: 'v0.2.0', summary: 'Fixes <bugs> & improvements',
      assets: [{ arch: 'universal', name: 'WorkFleet-0.2.0-macos-universal.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] });
    for (const bad of [{ version: '0.2' }, { build: '0' }, { repository: 'https://github.com/o/r' }, { signature: 'nonsense' },
      { signature: `sparkle:edSignature="${'A'.repeat(86)}==" length="999"` }, { summary: 'x'.repeat(501) }]) {
      await assert.rejects(writeUpdateFeed({ archive, signature, version: '0.2.0', build: '200', repository: 'o/r', output: folder, ...bad }));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});
