/** Prepare Xcode resources. Usage: node scripts/prepare-apple-build.mjs --platform ios|macos|share --output DIR */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { readBuildConfig, missingReleaseConfig } from './config.mjs';
import { buildWebAssets } from './build-web.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function appleInfoPlist(platform, config) {
  const shared = '<key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>Work Fleet</string><key>CFBundleDisplayName</key><string>Work Fleet</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>100</string>';
  const group = `<key>FleetCaptureAppGroup</key><string>${escape(config.appleAppGroupId)}</string>`;
  let content;
  if (platform === 'share') {
    content = shared + '<key>CFBundlePackageType</key><string>XPC!</string>' + group + '<key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.share-services</string><key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).ShareViewController</string><key>NSExtensionAttributes</key><dict><key>NSExtensionActivationRule</key><dict><key>NSExtensionActivationSupportsText</key><true/><key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsFileWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsImageWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsMovieWithMaxCount</key><integer>16</integer></dict></dict></dict>';
  } else {
    const client = config.google.clients[platform];
    const scheme = client ? client.split('.').reverse().join('.') : '';
    content = shared + '<key>CFBundlePackageType</key><string>APPL</string>' + `<key>GIDClientID</key><string>${escape(client)}</string>`;
    if (scheme) content += `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${escape(scheme)}</string></array></dict></array>`;
    content += platform === 'ios'
      ? group + '<key>LSRequiresIPhoneOS</key><true/><key>UILaunchScreen</key><dict/><key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>'
      : '<key>NSPrincipalClass</key><string>NSApplication</string><key>LSMinimumSystemVersion</key><string>13.0</string>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${content}</dict></plist>\n`;
}

async function ensureWebDependencies(root, environment) {
  const lock = await readFile(path.join(root, 'package-lock.json'));
  const hash = createHash('sha256').update(lock).digest('hex');
  const stamp = path.join(root, 'node_modules', '.work-fleet-apple-lock');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  try {
    if ((await readFile(stamp, 'utf8')).trim() === hash) {
      for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
        const installed = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
        if (installed.version !== version) throw new Error('Dependency version changed.');
        await access(path.join(root, 'node_modules', name));
      }
      return;
    }
  } catch (error) {
    if (!['ENOENT', undefined].includes(error.code)) throw error;
  }
  const npm = environment.WORK_FLEET_NPM || 'npm';
  const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  const options = { cwd: root, env: { ...environment, npm_config_cache: environment.npm_config_cache || path.join(root, 'build', 'apple', 'npm-cache') }, windowsHide: true };
  const result = process.platform === 'win32'
    ? await execute('cmd.exe', ['/d', '/c', npm, ...args], options)
    : await execute(npm, args, options);
  if (result.stdout) process.stdout.write(result.stdout);
  await writeFile(stamp, hash + '\n');
}

export async function prepareAppleBuild({ platform, output, root = repositoryRoot, environment = process.env, installDependencies = true }) {
  if (!['ios', 'macos', 'share'].includes(platform) || !output) throw new Error('Specify --platform ios|macos|share and --output DIR.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Apple asset preparation requires Node 22+.');
  const effective = { ...environment };
  if (Object.hasOwn(effective, 'DEVELOPMENT_TEAM')) effective.WORK_FLEET_APPLE_TEAM_ID = effective.DEVELOPMENT_TEAM;
  const config = await readBuildConfig(pathToFileURL(root + path.sep), effective);
  if (effective.CONFIGURATION === 'Release') {
    const missing = missingReleaseConfig(config, platform === 'share' ? 'ios' : platform);
    if (missing.length) throw new Error(`Apple release settings are incomplete: ${missing.join(', ')}.`);
  }
  await mkdir(output, { recursive: true });
  if (platform !== 'share') {
    if (installDependencies) await ensureWebDependencies(root, effective);
    await buildWebAssets({ root, destination: path.join(output, 'Assets'), configDestination: path.join(output, 'Config', 'public.json'), environment: effective });
  }
  await writeFile(path.join(output, 'Info.plist'), appleInfoPlist(platform, config));
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { platform: { type: 'string' }, output: { type: 'string' }, 'print-config': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-apple-build.mjs --platform ios|macos|share --output DIR\n--print-config prints allowlisted public settings for the command-line build wrapper.');
  } else if (values['print-config']) {
    console.log(JSON.stringify(await readBuildConfig(new URL('../', import.meta.url))));
  } else {
    await prepareAppleBuild({ platform: values.platform, output: values.output && path.resolve(values.output) });
    console.log(`Prepared Apple ${values.platform} resources.`);
  }
}
