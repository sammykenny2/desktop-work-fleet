import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readAppleVersion, readPlatformVersion, versionRecords } from '../scripts/platform-version.mjs';
import { prepareAppleBuild } from '../scripts/prepare-apple-build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);

async function checkout(records) {
  // Node runs a copied script from its real path, while macOS tmpdir() is the /var symlink to /private/var; a symlinked
  // checkout would put build/windows outside the stage path the script is given.
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'work-fleet-versions-'));
  for (const [file, content] of Object.entries(records)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), content);
  }
  return directory;
}

test('each platform reads its own version record', async () => {
  const directory = await checkout({
    [versionRecords.linux]: '1.2.3\n',
    [versionRecords.windows]: '<Project><PropertyGroup><Version>4.5.6</Version></PropertyGroup></Project>\n',
    [versionRecords.apple]: 'WORK_FLEET_APP_ID = app.workfleet.preview\nMARKETING_VERSION = 7.8.9\nCURRENT_PROJECT_VERSION = 42\n',
    [versionRecords.android]: 'android {\n    defaultConfig {\n        versionCode = 100\n        versionName = "3.2.1"\n    }\n}\n',
  });
  try {
    assert.equal(await readPlatformVersion('linux', directory), '1.2.3');
    assert.equal(await readPlatformVersion('windows', directory), '4.5.6');
    assert.equal(await readPlatformVersion('apple', directory), '7.8.9');
    assert.deepEqual(await readAppleVersion(directory), { version: '7.8.9', build: '42' });
    assert.equal(await readPlatformVersion('android', directory), '3.2.1');
    await assert.rejects(readPlatformVersion('ios', directory), /--platform linux\|windows\|apple\|android/);
    await writeFile(path.join(directory, versionRecords.linux), '1.2.3~preview\n');
    await assert.rejects(readPlatformVersion('linux', directory), /numeric x\.y\.z/);
    await writeFile(path.join(directory, versionRecords.apple), 'MARKETING_VERSION = 7.8.9\n');
    await assert.rejects(readAppleVersion(directory), /CURRENT_PROJECT_VERSION/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('repository records hold numeric versions and the packaging scripts never repeat them', async () => {
  const recorded = {
    linux: await readPlatformVersion('linux'),
    windows: await readPlatformVersion('windows'),
    apple: await readPlatformVersion('apple'),
    android: await readPlatformVersion('android'),
  };
  const packaging = {
    linux: ['scripts/generate-linux-package.mjs', 'scripts/package-linux.py', 'scripts/linux/build-native-app.sh',
      'scripts/linux/package-deb.sh', 'scripts/windows/Build-LinuxPackage.ps1'],
    windows: ['scripts/generate-windows-manifest.mjs', 'scripts/windows/Build-WindowsPackage.ps1'],
    apple: ['scripts/prepare-apple-build.mjs', 'scripts/macos/build-native-app.sh', 'scripts/macos/package-preview-app.sh',
      'scripts/macos/package-native-app.sh'],
    android: ['scripts/linux/build-android-app.sh', 'scripts/windows/Build-AndroidApp.ps1'],
  };
  for (const [platform, files] of Object.entries(packaging)) {
    const literal = new RegExp(`(?<![\\d.])${recorded[platform].replaceAll('.', '\\.')}(?![\\d.])`);
    for (const file of files) assert.equal(literal.test(await readFile(path.join(root, file), 'utf8')), false, file);
  }
  for (const project of ['src/native/windows/app/WorkFleet.Windows.csproj', 'src/native/windows/core/WorkFleet.Windows.Core.csproj']) {
    assert.equal((await readFile(path.join(root, project), 'utf8')).includes('<Version>'), false, project);
  }
  const gradle = await readFile(path.join(root, 'src/native/android/app/build.gradle.kts'), 'utf8');
  assert.ok(gradle.includes('archivesName.set("WorkFleet-${android.defaultConfig.versionName}-android")'));
});

test('packaging work directories are fixed and release files go directly in build/', async () => {
  const read = file => readFile(path.join(root, file), 'utf8');
  const entries = ['scripts/windows/Build-WindowsPackage.ps1', 'scripts/macos/package-preview-app.sh', 'scripts/macos/package-native-app.sh',
    'scripts/linux/build-android-app.sh', 'scripts/windows/Build-AndroidApp.ps1', 'scripts/package-linux.py'];
  for (const file of entries) assert.equal(/mktemp|NewGuid/.test(await read(file)), false, file);
  assert.ok((await read('scripts/windows/Build-WindowsPackage.ps1')).includes("$Work = Join-Path $ProjectRoot 'build/windows/package'"));
  assert.ok((await read('scripts/windows/Build-WindowsPackage.ps1')).includes("$Delivery = Join-Path $ProjectRoot 'build'"));
  assert.ok((await read('scripts/macos/package-preview-app.sh')).includes('OUTPUT="$PROJECT_ROOT/build/apple/preview-$PLATFORM"'));
  assert.ok((await read('scripts/macos/package-preview-app.sh')).includes('"$PROJECT_ROOT/build/"'));
  assert.ok((await read('scripts/macos/package-native-app.sh')).includes('OUTPUT="$PROJECT_ROOT/build/apple/export-$PLATFORM"'));
  assert.ok((await read('scripts/macos/package-native-app.sh')).includes('"$PROJECT_ROOT/build/"'));
  assert.ok((await read('scripts/linux/build-android-app.sh')).includes('cp -f "$output" "build/$package"'));
  assert.ok((await read('scripts/windows/Build-AndroidApp.ps1')).includes("$Delivery = Join-Path $ProjectRoot 'build'"));
});

test('MSIX uses the Windows version record and includes early Windows 11 while excluding Windows 10', async () => {
  const directory = await checkout({ [versionRecords.windows]: '<Project><PropertyGroup><Version>2.4.6</Version></PropertyGroup></Project>\n' });
  try {
    for (const file of ['generate-windows-manifest.mjs', 'config.mjs', 'apple-icons.mjs', 'platform-version.mjs']) {
      await mkdir(path.join(directory, 'scripts'), { recursive: true });
      await copyFile(path.join(root, 'scripts', file), path.join(directory, 'scripts', file));
    }
    const stage = path.join(directory, 'build', 'windows', 'stage');
    await execute(process.execPath, [path.join(directory, 'scripts', 'generate-windows-manifest.mjs'), '--stage', stage],
      { env: { PATH: process.env.PATH } });
    const manifest = await readFile(path.join(stage, 'AppxManifest.xml'), 'utf8');
    assert.match(manifest, /<Identity [^>]*Version="2\.4\.6\.0"/);
    assert.match(manifest, /<TargetDeviceFamily Name="Windows\.Desktop" MinVersion="10\.0\.22000\.0" MaxVersionTested="10\.0\.26200\.0"\s*\/>/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Apple Info.plist uses the xcconfig record and rejects local overrides', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-apple-version-'));
  try {
    const { version, build } = await readAppleVersion();
    const environment = { WORK_FLEET_APP_ID: 'app.workfleet.ios', CONFIGURATION: 'Debug', MARKETING_VERSION: version, CURRENT_PROJECT_VERSION: build };
    await prepareAppleBuild({ platform: 'share', output: directory, environment });
    const plist = await readFile(path.join(directory, 'Info.plist'), 'utf8');
    assert.ok(plist.includes(`<key>CFBundleShortVersionString</key><string>${version}</string>`));
    assert.ok(plist.includes(`<key>CFBundleVersion</key><string>${build}</string>`));
    await assert.rejects(prepareAppleBuild({ platform: 'share', output: directory, environment: { ...environment, MARKETING_VERSION: '9.9.9' } }),
      /MARKETING_VERSION is recorded in src\/native\/apple\/config\/WorkFleet\.xcconfig/);
    await assert.rejects(prepareAppleBuild({ platform: 'share', output: directory, environment: { ...environment, CURRENT_PROJECT_VERSION: '1' } }),
      /CURRENT_PROJECT_VERSION is recorded/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workflows and scripts ask platform-version.mjs only for platforms it records', async () => {
  const callers = ['.github/workflows/ci.yml', '.github/workflows/linux-release.yml', '.github/workflows/macos-release.yml',
    '.github/workflows/windows-preview.yml', 'scripts/linux/build-android-app.sh', 'scripts/linux/build-native-app.sh',
    'scripts/windows/Build-AndroidApp.ps1', 'scripts/windows/Build-LinuxPackage.ps1', 'scripts/windows/Build-WindowsPackage.ps1',
    'scripts/windows/Test-WindowsPackage.ps1', 'scripts/windows/Test-WindowsRecovery.ps1', 'scripts/windows/Test-WindowsUpdate.ps1'];
  for (const file of callers) {
    const platforms = [...(await readFile(path.join(root, file), 'utf8')).matchAll(/platform-version\.mjs'?\)? --platform ([a-z]+)/g)].map(match => match[1]);
    assert.ok(platforms.length > 0, file);
    for (const platform of platforms) assert.ok(Object.hasOwn(versionRecords, platform), `${file} asks for ${platform}`);
  }
});
