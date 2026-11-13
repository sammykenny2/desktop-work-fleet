/** Generate MSIX identity and owned artwork. Usage: node scripts/generate-windows-manifest.mjs --stage PATH */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildConfig } from './config.mjs';
import { readPlatformVersion } from './platform-version.mjs';
import common from '../src/i18n/locales/en/common.js';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/generate-windows-manifest.mjs --stage PATH\nStage must be under build/windows. Generates an x64 MSIX manifest and copies the committed tile images; the version comes from src/native/windows/Directory.Build.props.');
} else {
  if (args.length !== 2 || args[0] !== '--stage') throw new Error('Use --help.');
  const root = fileURLToPath(new URL('../', import.meta.url)), parent = path.join(root, 'build', 'windows'), stage = path.resolve(args[1]);
  const relative = path.relative(parent, stage);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Stage must be under build/windows.');
  const config = await readBuildConfig(new URL('../', import.meta.url));
  // ADR-069: the Windows identity is set independently of the Apple/Android app ID and the eventual Certum publisher.
  const name = config.windows.packageId || 'dev.sammykenny2.pinitanywhere';
  if (!/^[a-zA-Z0-9.-]{3,50}$/.test(name)) throw new Error('Set PIN_IT_ANYWHERE_WINDOWS_PACKAGE_ID.');
  const version = await readPlatformVersion('windows');
  const displayName = common['common.appName'];
  const publisher = config.windows.publisher || 'CN=Pin It Anywhere Preview', publisherName = config.windows.publisherDisplayName || displayName;
  // ADR-043: the app enables the sign-in StartupTask from its own preference, so the manifest leaves it disabled.
  // ADR-034: include early Windows 11 and exclude Windows 10 at installation; Explorer topology is discovered at runtime.
  const minimumWindows = '10.0.22000.0', testedWindows = '10.0.26200.0';
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const images = path.join(stage, 'PackageAssets'); await mkdir(images, { recursive: true });
  // Unqualified scale-100 images from scripts/render-brand-assets.mjs --install: the package has no resources.pri, so
  // Windows scales these for other DPIs and target sizes.
  for (const name of ['Square44x44Logo', 'Square150x150Logo', 'StoreLogo'])
    await copyFile(path.join(root, 'src', 'native', 'windows', 'package-assets', `${name}.png`), path.join(images, `${name}.png`));
  await writeFile(path.join(stage, 'AppxManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap5 uap10 rescap">
  <Identity Name="${escape(name)}" Version="${version}.0" Publisher="${escape(publisher)}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>${escape(displayName)}</DisplayName><PublisherDisplayName>${escape(publisherName)}</PublisherDisplayName><Description>Work notes with local storage and optional Google sync</Description><Logo>PackageAssets\\StoreLogo.png</Logo></Properties>
  <Resources><Resource Language="zh-TW" /><Resource Language="en-US" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${minimumWindows}" MaxVersionTested="${testedWindows}" /></Dependencies>
  <Capabilities><Capability Name="internetClient" /><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications><Application Id="PinItAnywhere" Executable="PinItAnywhere.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
    <uap:VisualElements DisplayName="${escape(displayName)}" Description="Quick work notes" Square150x150Logo="PackageAssets\\Square150x150Logo.png" Square44x44Logo="PackageAssets\\Square44x44Logo.png" BackgroundColor="transparent" />
    <Extensions><uap5:Extension Category="windows.startupTask" Executable="PinItAnywhere.exe" EntryPoint="Windows.FullTrustApplication"><uap5:StartupTask TaskId="PinItAnywhereStartup" Enabled="false" DisplayName="${escape(displayName)}" /></uap5:Extension></Extensions>
  </Application></Applications>
</Package>\n`);
  console.log('Generated x64 MSIX manifest and copied its tile images.');
}
