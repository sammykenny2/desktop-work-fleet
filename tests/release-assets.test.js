import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { writeUpdateFeed } from '../scripts/macos/write-update-feed.mjs';
import { manifestNames, releaseAssets, validateReleaseAssets } from '../scripts/validate-release-assets.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

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
    await writeFile(path.join(folder, 'WorkFleet-0.3.7-android-debug.apk'), 'debug');
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /unexpected WorkFleet-0\.3\.7-android-debug\.apk/);
    await unlink(path.join(folder, 'WorkFleet-0.3.7-android-debug.apk'));
    await unlink(path.join(folder, 'WorkFleet-0.3.7-android-release.apk.sha256'));
    await assert.rejects(validateReleaseAssets({ dir: folder, version: '0.3.7', repository: 'o/r' }), /missing WorkFleet-0\.3\.7-android-release\.apk\.sha256/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('desktop-only releases require every desktop asset and reject Android assets, through the API and CLI', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'work-fleet-desktop-release-'));
  const version = '0.6.3'; const options = { dir: folder, version, repository: 'o/r', includeAndroid: false };
  try {
    await release(folder, version);
    await assert.rejects(validateReleaseAssets(options), /unexpected WorkFleet-0\.6\.3-android-release\.apk/);
    for (const name of releaseAssets(version).android) await unlink(path.join(folder, name));
    const files = await validateReleaseAssets(options);
    assert.equal(files.length, 13);
    assert.deepEqual(files.sort(), Object.values(releaseAssets(version, { includeAndroid: false })).flat().sort());
    await assert.rejects(validateReleaseAssets({ ...options, includeAndroid: true }), /missing WorkFleet-0\.6\.3-android-release\.apk/);
    const { stdout } = await execute(process.execPath, [new URL('../scripts/validate-release-assets.mjs', import.meta.url).pathname,
      '--dir', folder, '--version', version, '--repository', 'o/r', '--desktop-only']);
    assert.match(stdout, /13 files checked/);
    await unlink(path.join(folder, 'work-fleet-update-linux.json'));
    await assert.rejects(validateReleaseAssets(options), /missing work-fleet-update-linux\.json/);
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
  // Publishing waits for every selected platform and uploads the whole checked folder.
  assert.ok(release.split('\n').includes('    needs: [guard, windows, linux, macos, android]'), 'publish needs every platform');
  assert.match(release, /include_android:\n\s+description:[^\n]+\n\s+type: boolean\n\s+default: true/);
  assert.match(release, /android:\n\s+name: Android\n\s+needs: guard\n\s+if: \$\{\{ inputs\.include_android \}\}/);
  assert.match(release, /!cancelled\(\) && needs\.guard\.result == 'success' && needs\.windows\.result == 'success'/);
  assert.match(release, /needs\.linux\.result == 'success' && needs\.macos\.result == 'success'/);
  assert.match(release, /needs\.android\.result == 'success' \|\| \(!inputs\.include_android && needs\.android\.result == 'skipped'\)/);
  assert.match(release, /if \[ "\$INCLUDE_ANDROID" = false \]; then args\+=\(--desktop-only\); fi/);
  assert.match(release, /if \[ "\$INCLUDE_ANDROID" = true \]; then\n\s+cat >> "\$RUNNER_TEMP\/notes\.md" <<EOF\n\s+## Android/);
  assert.match(release, /--notes-file "\$RUNNER_TEMP\/notes\.md" dist\/\*\n/);
  for (const file of await readdir(workflows)) {
    const source = await read(file);
    if (file !== 'preview-release.yml') assert.doesNotMatch(source, /gh release (create|upload)/, `${file} must not publish`);
    assert.doesNotMatch(source, /(windows|linux|macos|android)-v\$/, `${file} must not use per-platform tags`);
  }
});

test('the release notes shell includes Android installation steps only when selected', { skip: process.platform === 'win32' }, async () => {
  const workflow = await readFile(new URL('../.github/workflows/preview-release.yml', import.meta.url), 'utf8');
  const lines = workflow.split('\n');
  const step = lines.indexOf('      - name: Create the release');
  const start = lines.indexOf('        run: |', step);
  assert.ok(step >= 0 && start > step);
  const script = lines.slice(start + 1).map(line => line.slice(10)).join('\n');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'work-fleet-release-notes-'));
  try {
    for (const includeAndroid of [true, false]) {
      // Run the production shell with only the final publishing command replaced; no GitHub request is made.
      await execute('bash', ['-eu', '-c', `gh() { return 0; }\n${script}`], { cwd: folder,
        env: { ...process.env, RUNNER_TEMP: folder, GITHUB_REPOSITORY: 'o/r', VERSION: '0.6.3', TAG: 'v0.6.3', COMMIT: 'test-source',
          CHANGES: '- Preserve group regions.', INCLUDE_ANDROID: String(includeAndroid),
          PLATFORMS: includeAndroid ? 'Windows, macOS, Linux and Android' : 'Windows, macOS and Linux' } });
      const notes = await readFile(path.join(folder, 'notes.md'), 'utf8');
      for (const platform of ['Windows', 'macOS', 'Linux', 'Updates']) assert.match(notes, new RegExp(`^## ${platform}$`, 'm'));
      assert.match(notes, /Preserve group regions/);
      if (includeAndroid) assert.match(notes, /^## Android$/m);
      else assert.doesNotMatch(notes, /Android|android-release\.apk/);
      assert.doesNotMatch(notes, /android-debug\.apk|fixed test key/);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('Android delivery uses release signing and inspects the actual package before uploading', async () => {
  const source = await readFile(new URL('../.github/workflows/android-apk.yml', import.meta.url), 'utf8');
  assert.match(source, /build-android-app\.sh --signed --apk/);
  assert.match(source, /check_android_package\.py --apk/);
  assert.match(source, /--sha1 "\$WORK_FLEET_ANDROID_RELEASE_SHA1"/);
  assert.ok(source.indexOf('check_android_package.py') < source.indexOf('- name: Save APK and checksum'));
  assert.doesNotMatch(source, /ANDROID_DEBUG_KEYSTORE_BASE64|WORK_FLEET_ANDROID_DEBUG_SHA1|android-debug\.apk/);
  for (const name of ['KEYSTORE_BASE64', 'KEY_ALIAS', 'STORE_PASSWORD', 'KEY_PASSWORD']) {
    assert.ok(source.includes(`secrets.ANDROID_RELEASE_${name}`));
  }
});
