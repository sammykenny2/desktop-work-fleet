/** Generate MSIX identity and owned artwork. Usage: node scripts/generate-windows-manifest.mjs --stage PATH */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildConfig } from './config.mjs';
import { writePaperIcon } from './apple-icons.mjs';
import { readPlatformVersion } from './platform-version.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/generate-windows-manifest.mjs --stage PATH\nStage must be under build/windows. Generates an x64 MSIX manifest and owned icons; the version comes from src/native/windows/Directory.Build.props.');
} else {
  if (args.length !== 2 || args[0] !== '--stage') throw new Error('Use --help.');
  const root = fileURLToPath(new URL('../', import.meta.url)), parent = path.join(root, 'build', 'windows'), stage = path.resolve(args[1]);
  const relative = path.relative(parent, stage);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Stage must be under build/windows.');
  const config = await readBuildConfig(new URL('../', import.meta.url));
  const name = config.windows.packageId || config.appId || 'app.workfleet.preview';
  if (!/^[a-zA-Z0-9.-]{3,50}$/.test(name)) throw new Error('Set WORK_FLEET_WINDOWS_PACKAGE_ID.');
  const version = await readPlatformVersion('windows');
  const publisher = config.windows.publisher || 'CN=Work Fleet Preview', publisherName = config.windows.publisherDisplayName || 'Work Fleet';
  // Windows 11 24H2 (build 26100) is where Explorer moved the wallpaper host under Progman, the desktop structure the
  // desktop and wallpaper layers are built and tested for; the Store does not offer the package to older Windows.
  const minimumWindows = '10.0.26100.0', testedWindows = '10.0.26200.0';
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const images = path.join(stage, 'PackageAssets'); await mkdir(images, { recursive: true });
  for (const size of [44, 50, 150]) await writePaperIcon(path.join(images, `paper-${size}.png`), size);
  await writeFile(path.join(stage, 'AppxManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="${escape(name)}" Version="${version}.0" Publisher="${escape(publisher)}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>Work Fleet</DisplayName><PublisherDisplayName>${escape(publisherName)}</PublisherDisplayName><Description>Work notes with local storage and optional Google sync</Description><Logo>PackageAssets\\paper-50.png</Logo></Properties>
  <Resources><Resource Language="zh-TW" /><Resource Language="en-US" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${minimumWindows}" MaxVersionTested="${testedWindows}" /></Dependencies>
  <Capabilities><Capability Name="internetClient" /><rescap:Capability Name="runFullTrust" /></Capabilities>
  <Applications><Application Id="WorkFleet" Executable="WorkFleet.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
    <uap:VisualElements DisplayName="Work Fleet" Description="Quick work notes" Square150x150Logo="PackageAssets\\paper-150.png" Square44x44Logo="PackageAssets\\paper-44.png" BackgroundColor="transparent" />
  </Application></Applications>
</Package>\n`);
  console.log('Generated x64 MSIX manifest and icons.');
}
