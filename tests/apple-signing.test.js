import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appleExportOptions } from '../scripts/generate-apple-export-options.mjs';

const execute = promisify(execFile);
const config = { appId: 'app.workfleet.preview', appleTeamId: 'ABCDE12345' };
const manual = { platform: 'macos', method: 'developer-id', config,
  applicationIdentity: 'Developer ID Application: Example & Co (ABCDE12345)',
  provisioningProfile: '12345678-1234-1234-1234-123456789abc' };

test('manual Developer ID export selects the imported certificate and app profile', () => {
  const plist = appleExportOptions(manual);
  assert.match(plist, /<key>signingStyle<\/key><string>manual<\/string>/);
  assert.match(plist, /<key>signingCertificate<\/key><string>Developer ID Application: Example &amp; Co \(ABCDE12345\)<\/string>/);
  assert.match(plist, /<key>provisioningProfiles<\/key><dict><key>app.workfleet.preview<\/key><string>12345678-1234-1234-1234-123456789abc<\/string><\/dict>/);
  assert.match(plist, /<key>manageAppVersionAndBuildNumber<\/key><false\/>/);
});

test('automatic Apple exports remain available; incomplete manual settings fail', () => {
  assert.match(appleExportOptions({ platform: 'ios', method: 'app-store-connect', config }), /<string>automatic<\/string>/);
  for (const override of [{ platform: 'ios' }, { method: 'debugging' }, { applicationIdentity: '' },
    { provisioningProfile: '' }, { config: { appleTeamId: config.appleTeamId } }, { config: { appId: config.appId } }]) {
    assert.throws(() => appleExportOptions({ ...manual, ...override }));
  }
});

test('installer-free packaging rejects requests with no deliverable or incompatible inputs', { skip: process.platform === 'win32' }, async () => {
  const script = fileURLToPath(new URL('../scripts/macos/package-native-app.sh', import.meta.url));
  for (const args of [
    ['--platform', 'ios', '--method', 'debugging', '--no-pkg'],
    ['--platform', 'macos', '--method', 'developer-id', '--no-pkg'],
    ['--platform', 'macos', '--method', 'app-store-connect', '--dmg', '--no-pkg'],
    ['--platform', 'macos', '--method', 'developer-id', '--dmg', '--no-pkg', '--installer-identity', 'Example'],
    ['--platform', 'macos', '--method', 'developer-id', '--dmg', '--no-pkg', '--notary-profile', 'Example'],
  ]) {
    await assert.rejects(execute('bash', [script, ...args]), error => error.code === 2);
  }
});

test('manual archive signing rejects incomplete or non-macOS Release requests before building', { skip: process.platform === 'win32' }, async () => {
  const script = fileURLToPath(new URL('../scripts/macos/build-native-app.sh', import.meta.url));
  for (const args of [
    ['--platform', 'macos', '--release', '--application-identity', 'Example'],
    ['--platform', 'macos', '--release', '--provisioning-profile', manual.provisioningProfile],
    ['--platform', 'macos', '--application-identity', 'Example', '--provisioning-profile', manual.provisioningProfile],
    ['--platform', 'ios', '--release', '--application-identity', 'Example', '--provisioning-profile', manual.provisioningProfile],
  ]) {
    await assert.rejects(execute('bash', [script, ...args]), error => error.code === 2);
  }
});

test('notarized DMG and update ZIP need no Installer identity and publish only after all checks pass', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'work-fleet-signing-')));
  try {
    for (const file of ['scripts/macos/package-native-app.sh', 'scripts/macos/write-update-feed.mjs',
      'scripts/testing/check_macos_runtime.py',
      'scripts/generate-apple-export-options.mjs', 'scripts/config.mjs', 'scripts/toolchain-env.mjs']) {
      const target = path.join(directory, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(new URL('../' + file, import.meta.url), target);
    }
    await writeFile(path.join(directory, '.env'), 'WORK_FLEET_APP_ID=app.workfleet.preview\nWORK_FLEET_APPLE_TEAM_ID=ABCDE12345\n');
    const archive = path.join(directory, 'build/apple/WorkFleetMac.xcarchive');
    const app = path.join(archive, 'Products/Applications/WorkFleetMac.app');
    await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
    await mkdir(path.join(app, 'Contents/Resources/Config'), { recursive: true });
    await writeFile(path.join(archive, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>ApplicationProperties</key><dict><key>CFBundleShortVersionString</key><string>0.2.0</string><key>CFBundleVersion</key><string>200</string></dict></dict></plist>');
    await writeFile(path.join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>WorkFleetMac</string></dict></plist>');
    await writeFile(path.join(app, 'Contents/MacOS/WorkFleetMac'), '#!/bin/bash\n[[ "$1" == --check-runtime ]] || exit 99\necho "PASS Work Fleet runtime load"\n');
    await chmod(path.join(app, 'Contents/MacOS/WorkFleetMac'), 0o755);
    const framework = path.join(app, 'Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle');
    await mkdir(path.dirname(framework), { recursive: true });
    await writeFile(framework, 'fixture');
    await writeFile(path.join(app, 'Contents/Resources/Config/public.json'), JSON.stringify({ update: { repository: 'sammykenny2/desktop-work-fleet' } }));
    const tools = path.join(directory, 'tools');
    await mkdir(tools);
    const scripts = {
      xcodebuild: 'while [[ $# -gt 0 ]]; do case "$1" in -archivePath) archive="$2"; shift 2;; -exportPath) output="$2"; shift 2;; *) shift;; esac; done\nmkdir -p "$output"\ncp -R "$archive/Products/Applications/WorkFleetMac.app" "$output/"',
      lipo: 'echo "arm64 x86_64"',
      otool: 'if [[ "$*" == *WorkFleetMac ]]; then\nif [[ "${FAIL_RUNTIME:-}" != 1 || "$2" != x86_64 ]]; then printf "Load command 0\\n cmd LC_RPATH\\n path @executable_path/../Frameworks (offset 12)\\n"; fi\nprintf "Load command 1\\n cmd LC_LOAD_DYLIB\\n name @rpath/Sparkle.framework/Versions/B/Sparkle (offset 24)\\n"\nfi',
      ditto: 'if [[ "$1" == -c ]]; then printf archive > "${@: -1}"; else cp -R "$1" "$2"; fi',
      hdiutil: 'printf image > "${@: -1}"',
      productbuild: '[[ "${ALLOW_PKG:-}" == 1 ]] || exit 99\nprintf package > "${@: -1}"',
      codesign: ':',
      spctl: ':',
      xcrun: 'if [[ "$1" == notarytool && "${FAIL_DMG:-}" == 1 && "$3" == *.dmg ]]; then exit 9; fi',
    };
    for (const [name, body] of Object.entries(scripts)) {
      const file = path.join(tools, name);
      await writeFile(file, '#!/bin/bash\nset -euo pipefail\nprintf "%s\\n" "$0 $*" >> "$TOOL_LOG"\n' + body + '\n');
      await chmod(file, 0o755);
    }
    const signer = path.join(directory, 'build/apple/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update');
    await mkdir(path.dirname(signer), { recursive: true });
    await writeFile(signer, '#!/bin/bash\nprintf \'sparkle:edSignature="' + 'A'.repeat(86) + '==" length="%s"\\n\' "$(wc -c < "${@: -1}" | tr -d \' \')"\n');
    await chmod(signer, 0o755);
    const env = { ...process.env, PATH: tools + path.delimiter + process.env.PATH, TOOL_LOG: path.join(directory, 'tools.log'),
      WORK_FLEET_SIGNING_KEYCHAIN: path.join(directory, 'temporary.keychain-db') };
    const args = [path.join(directory, 'scripts/macos/package-native-app.sh'), '--platform', 'macos', '--method', 'developer-id',
      '--application-identity', manual.applicationIdentity, '--provisioning-profile', manual.provisioningProfile,
      '--notary-profile', 'fixture-notary', '--dmg', '--no-pkg'];
    await execute('bash', args, { cwd: directory, env });
    const files = await readdir(path.join(directory, 'build'));
    for (const file of ['WorkFleet-0.2.0-macos-universal.dmg', 'WorkFleet-0.2.0-macos-universal.dmg.sha256',
      'WorkFleet-0.2.0-macos-universal.zip', 'WorkFleet-0.2.0-macos-universal.zip.sha256', 'appcast.xml', 'work-fleet-update.json']) assert.ok(files.includes(file));
    assert.equal(files.some(file => file.endsWith('.pkg')), false);
    const log = await readFile(env.TOOL_LOG, 'utf8');
    assert.equal(log.includes('/productbuild '), false);
    assert.ok(log.includes('--keychain ' + env.WORK_FLEET_SIGNING_KEYCHAIN));
    assert.match(log, /stapler validate .*WorkFleetMac\.app/);
    assert.match(log, /spctl --assess --type open/);
    // Notarization is optional for a local signed DMG. macOS Bash 3 must also handle the empty feed array.
    const notaryIndex = args.indexOf('--notary-profile');
    const localArgs = args.filter((value, index) => index !== notaryIndex && index !== notaryIndex + 1);
    const local = await execute('bash', localArgs, { cwd: directory, env });
    assert.match(local.stdout, /Export work directory:/);
    const profileIndex = localArgs.indexOf('--provisioning-profile');
    const automaticArgs = localArgs.filter((value, index) => index !== profileIndex && index !== profileIndex + 1);
    await execute('bash', automaticArgs, { cwd: directory, env });
    const pkgArgs = automaticArgs.filter(value => value !== '--no-pkg');
    await execute('bash', pkgArgs, { cwd: directory, env: { ...env, ALLOW_PKG: '1' } });
    assert.ok((await readdir(path.join(directory, 'build'))).includes('WorkFleet-0.2.0-macos-universal.pkg'));
    const output = path.join(directory, 'build/WorkFleet-0.2.0-macos-universal.dmg');
    await writeFile(output, 'previous successful package');
    const priorFeed = await readFile(path.join(directory, 'build/appcast.xml'), 'utf8');
    const beforeRuntimeFailure = await readFile(env.TOOL_LOG, 'utf8');
    await assert.rejects(execute('bash', args, { cwd: directory, env: { ...env, FAIL_RUNTIME: '1' } }));
    const runtimeFailureLog = (await readFile(env.TOOL_LOG, 'utf8')).slice(beforeRuntimeFailure.length);
    assert.equal(runtimeFailureLog.includes('notarytool submit'), false);
    assert.equal(await readFile(output, 'utf8'), 'previous successful package');
    assert.equal(await readFile(path.join(directory, 'build/appcast.xml'), 'utf8'), priorFeed);
    await assert.rejects(execute('bash', args, { cwd: directory, env: { ...env, FAIL_DMG: '1' } }), error => error.code === 9);
    assert.equal(await readFile(output, 'utf8'), 'previous successful package');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
