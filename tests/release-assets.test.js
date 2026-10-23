import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeUpdateFeed } from '../scripts/macos/write-update-feed.mjs';
import { manifestNames, releaseAssets, validateReleaseAssets } from '../scripts/validate-release-assets.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// One folder shaped like the four platform builds' output, with the macOS feed from the real writer.
async function release(folder, version) {
  const write = async (name, text) => { await writeFile(path.join(folder, name), text); return Buffer.from(text); };
  const checksum = async (name, bytes) => write(`${name}.sha256`, `${digest(bytes)}  ${name}\n`);
  const manifest = async (platform, arch, name, bytes) => write(manifestNames[platform], JSON.stringify({ schemaVersion: 1, platform, version,
    tag: `v${version}`, summary: 'Fixes', assets: [{ arch, name, size: bytes.length, sha256: digest(bytes) }] }, null, 2));
  const assets = releaseAssets(version);
  const msix = await write(assets.windows[0], 'msix'); await checksum(assets.windows[0], msix); await write('WorkFleet-preview.cer', 'cer');
  await manifest('windows', 'x64', assets.windows[0], msix);
  const deb = await write(assets.linux[0], 'deb'); await checksum(assets.linux[0], deb); await manifest('linux', 'all', assets.linux[0], deb);
  const dmg = await write(assets.macos[0], 'dmg'); await checksum(assets.macos[0], dmg);
  const zip = await write(assets.macos[2], 'zip'); await checksum(assets.macos[2], zip);
  await writeUpdateFeed({ archive: path.join(folder, assets.macos[2]), signature: `sparkle:edSignature="${'A'.repeat(86)}==" length="${zip.length}"`,
    version, build: '307', repository: 'o/r', output: folder, summary: 'Fixes' });
  const apk = await write(assets.android[0], 'apk'); await checksum(assets.android[0], apk);
}

test('one vX.Y.Z release carries every platform, and each manifest and the appcast point into it', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/update-feed.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifestNames, fixture.manifestNames);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'work-fleet-release-'));
  try {
    await release(folder, '0.3.7');
    const files = await validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' });
    assert.equal(files.length, 15);
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'another/repo' }), /appcast\.xml does not point/);
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.8', repository: 'o/r' }), /missing WorkFleet-0\.3\.8-x64\.msix/);

    const windows = path.join(folder, manifestNames.windows); const original = await readFile(windows, 'utf8');
    await writeFile(windows, original.replace('"v0.3.7"', '"windows-v0.3.7"'));
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /work-fleet-update-windows\.json does not describe windows v0\.3\.7/);
    const entry = JSON.parse(original).assets[0];
    await writeFile(windows, original.replace(`"size": ${entry.size}`, `"size": ${entry.size + 1}`));
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /wrong size or SHA-256 for WorkFleet-0\.3\.7-x64\.msix/);
    // A manifest that is consistent with a file but would not install: the certificate, another architecture or two
    // entries for one architecture, which the hosts refuse.
    const cer = await readFile(path.join(folder, 'WorkFleet-preview.cer'));
    const rewrite = assets => writeFile(windows, JSON.stringify({ ...JSON.parse(original), assets }));
    for (const assets of [[{ ...entry, name: 'WorkFleet-preview.cer', size: cer.length, sha256: digest(cer) }], [{ ...entry, arch: 'arm64' }], [entry, entry]]) {
      await rewrite(assets);
      await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /must list exactly WorkFleet-0\.3\.7-x64\.msix for x64/);
    }
    await writeFile(windows, original);
    const linux = path.join(folder, manifestNames.linux); const linuxOriginal = await readFile(linux, 'utf8');
    await writeFile(linux, linuxOriginal.replace('"arch": "all"', '"arch": "amd64"'));
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /must list exactly work-fleet_0\.3\.7_all\.deb for all/);
    await writeFile(linux, linuxOriginal);

    await writeFile(path.join(folder, 'work-fleet_0.3.7_all.deb'), 'changed');
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /work-fleet_0\.3\.7_all\.deb\.sha256 does not match/);
    await writeFile(path.join(folder, 'work-fleet_0.3.7_all.deb'), 'deb');

    // Every platform must be there, and nothing else: a shared name such as the old work-fleet-update.json is refused.
    await writeFile(path.join(folder, 'work-fleet-update.json'), '{}');
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /unexpected work-fleet-update\.json/);
    await unlink(path.join(folder, 'work-fleet-update.json'));
    await unlink(path.join(folder, 'WorkFleet-0.3.7-android-debug.apk.sha256'));
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /missing WorkFleet-0\.3\.7-android-debug\.apk\.sha256/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

// Each platform's build saves exactly its share of the release, and only preview-release.yml publishes.
test('the release workflow publishes the files the validator expects, from one build per platform', async () => {
  const workflows = new URL('../.github/workflows/', import.meta.url);
  const read = file => readFile(new URL(file, workflows), 'utf8');
  const release = await read('preview-release.yml');
  const builds = { windows: 'windows-package.yml', linux: 'linux-package.yml', macos: 'macos-package.yml', android: 'android-apk.yml' };
  for (const [platform, file] of Object.entries(builds)) {
    assert.ok(release.split('\n').includes(`    uses: ./.github/workflows/${file}`), `${file} is called`);
    const lines = (await read(file)).split('\n');
    assert.ok(lines.includes('  workflow_call:'), `${file} can be called`);
    // The upload's path list follows its artifact name.
    const start = lines.indexOf(`          name: release-${platform}`);
    assert.ok(start > 0 && lines[start + 1] === '          path: |', `${file} saves release-${platform}`);
    const files = [];
    for (let index = start + 2; lines[index].startsWith(' '.repeat(12)); index++) {
      files.push(lines[index].trim().replace(/^build\//, '').replace(/\$\{\{ (inputs\.version|steps\.package\.outputs\.version) \}\}/g, '9.8.7'));
    }
    assert.deepEqual(files.sort(), [...releaseAssets('9.8.7')[platform]].sort(), file);
  }
  assert.match(release, /pattern: release-\*\n {10}merge-multiple: true\n {10}path: dist\n/);
  assert.match(release, /validate-release-assets\.mjs --dir dist --version "\$VERSION" --repository "\$GITHUB_REPOSITORY"/);
  // Publishing waits for every platform and uploads the whole checked folder.
  assert.ok(release.split('\n').includes('    needs: [guard, windows, linux, macos, android]'), 'publish needs every platform');
  assert.match(release, /--notes-file "\$RUNNER_TEMP\/notes\.md" dist\/\*\n/);
  for (const file of await readdir(workflows)) {
    const source = await read(file);
    if (file !== 'preview-release.yml') assert.doesNotMatch(source, /gh release (create|upload)/, `${file} must not publish`);
    assert.doesNotMatch(source, /(windows|linux|macos|android)-v\$/, `${file} must not use per-platform tags`);
  }
});
