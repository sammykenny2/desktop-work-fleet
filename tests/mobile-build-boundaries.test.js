import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const workflows = new URL('../.github/workflows/', import.meta.url);

test('public workflows cannot upload IPAs or use the retired iOS signing secrets', async () => {
  await assert.rejects(access(new URL('ios-ipa.yml', workflows)), { code: 'ENOENT' });
  for (const file of await readdir(workflows)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const source = await readFile(new URL(file, workflows), 'utf8');
    assert.doesNotMatch(source, /\.ipa\b/i, `${file} must not upload an iOS device package`);
    assert.doesNotMatch(source, /secrets\.IOS_/i, `${file} must not restore iOS signing credentials`);
    assert.doesNotMatch(source, /--platform\s+['"]?ios\b/i, `${file} must keep iOS builds local`);
  }
});

test('the macOS artifact allowlist excludes stale iOS device and simulator packages', async () => {
  const source = await readFile(new URL('apple-native-build.yml', workflows), 'utf8');
  assert.match(source, /build-native-app\.sh --platform macos --unsigned/);
  assert.match(source, /package-preview-app\.sh --platform macos/);
  assert.doesNotMatch(source, /matrix\.|inputs\.platform|GOOGLE_IOS_CLIENT_ID/);
  const match = source.match(/\n          path: \|\n((?:            [^\n]+\n)+)/);
  assert.ok(match, 'the preview artifact needs an explicit allowlist');
  const patterns = match[1].trim().split('\n').map(line => line.trim());
  const matches = file => patterns.some(pattern => {
    const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${escaped}$`).test(file);
  });
  for (const file of ['build/WorkFleet-0.3.2-macos-universal-unsigned.zip',
    'build/WorkFleet-0.3.2-macos-universal-unsigned.zip.sha256',
    'build/apple/preview-macos/README.txt', 'build/apple/preview-macos/toolchain.txt']) {
    assert.ok(matches(file), `expected macOS output: ${file}`);
  }
  for (const file of ['build/WorkFleet-0.3.2-ios-development.ipa',
    'build/WorkFleet-0.3.2-ios-development.ipa.sha256', 'build/WorkFleet-0.3.2-ios-unsigned.ipa',
    'build/WorkFleet-0.3.2-ios-simulator.zip', 'build/WorkFleet-0.3.2-ios-simulator.zip.sha256',
    'build/apple/preview-ios/README.txt', 'build/apple/preview-ios/toolchain.txt']) {
    assert.equal(matches(file), false, `private iOS output: ${file}`);
  }
});
