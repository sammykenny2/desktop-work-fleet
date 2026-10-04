/** Generate the native macOS/iOS Xcode project. Usage: node scripts/generate-apple-project.mjs [--help] */
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildConfig } from './config.mjs';
import { generateAppleIcons } from './apple-icons.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/generate-apple-project.mjs\nRun npm run build first. Writes build/apple/WorkFleet.xcodeproj and public app settings.');
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = path.join(root, 'build', 'apple');
  const project = path.join(output, 'WorkFleet.xcodeproj');
  const config = await readBuildConfig(new URL('../', import.meta.url));
  await mkdir(path.join(project, 'xcshareddata', 'xcschemes'), { recursive: true });
  await cp(path.join(root, 'build', 'app'), path.join(output, 'Assets'), { recursive: true });
  await mkdir(path.join(output, 'Config'), { recursive: true });
  await writeFile(path.join(output, 'Config', 'public.json'), JSON.stringify(config, null, 2) + '\n');
  const objects = {}; let counter = 0;
  const add = object => { const id = (++counter).toString(16).toUpperCase().padStart(24, '0'); objects[id] = object; return id; };
  const projectId = add({});
  const file = (name, type) => add({ isa: 'PBXFileReference', lastKnownFileType: type, path: name, sourceTree: '<absolute>' });
  const shared = (await readdir(path.join(root, 'src', 'native', 'apple', 'Shared'))).filter(name => name.endsWith('.swift')).sort()
    .map(name => file(path.join(root, 'src', 'native', 'apple', 'Shared', name), 'sourcecode.swift'));
  const resources = [file(path.join(output, 'Assets'), 'folder'), file(path.join(output, 'Config'), 'folder'),
    file(path.join(root, 'src', 'native', 'apple', 'PrivacyInfo.xcprivacy'), 'text.xml'),
    file(path.join(root, 'LICENSE'), 'text'), file(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'text')];
  const packageId = add({ isa: 'XCRemoteSwiftPackageReference', repositoryURL: 'https://github.com/google/GoogleSignIn-iOS',
    requirement: { kind: 'exactVersion', version: '9.2.0' } });
  const group = add({ isa: 'PBXGroup', children: [...shared, ...resources], sourceTree: '<group>' });
  const products = add({ isa: 'PBXGroup', children: [], name: 'Products', sourceTree: '<group>' }); objects[group].children.push(products);
  const settings = (platform, mode) => ({
    SWIFT_VERSION: '5.0', SWIFT_STRICT_CONCURRENCY: 'minimal', CLANG_ENABLE_MODULES: 'YES',
    SWIFT_OPTIMIZATION_LEVEL: mode === 'Release' ? '-O' : '-Onone', DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
    PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: config.appId || 'app.workfleet.preview',
    CODE_SIGN_STYLE: 'Automatic', DEVELOPMENT_TEAM: config.appleTeamId,
    WORK_FLEET_APP_GROUP_ID: config.appleAppGroupId,
    CODE_SIGN_ENTITLEMENTS: path.join(root, 'src', 'native', 'apple', platform, 'WorkFleet.entitlements'),
    INFOPLIST_FILE: path.join(output, `${platform}-Info.plist`), GENERATE_INFOPLIST_FILE: 'NO',
    OTHER_LDFLAGS: ['$(inherited)', '-lsqlite3'], ENABLE_USER_SCRIPT_SANDBOXING: 'YES', ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
    WORK_FLEET_ROOT: root, WORK_FLEET_PACKAGES_DIR: path.join(output, 'SourcePackages'),
    ...(platform === 'macos' ? { SDKROOT: 'macosx', MACOSX_DEPLOYMENT_TARGET: '13.0', SUPPORTED_PLATFORMS: 'macosx', ENABLE_HARDENED_RUNTIME: 'YES' }
      : { SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: '16.0', TARGETED_DEVICE_FAMILY: '1,2', SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator', SUPPORTS_MACCATALYST: 'NO' }),
  });
  const configs = fn => add({ isa: 'XCConfigurationList', buildConfigurations: ['Debug', 'Release'].map(name =>
    add({ isa: 'XCBuildConfiguration', name, buildSettings: fn(name) })), defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release' });
  const targets = [];
  const buildFiles = refs => refs.map(fileRef => add({ isa: 'PBXBuildFile', fileRef }));
  let iosTarget;
  for (const platform of ['macos', 'ios']) {
    const name = platform === 'macos' ? 'WorkFleetMac' : 'WorkFleetIOS';
    const folder = path.join(root, 'src', 'native', 'apple', platform);
    const sources = (await readdir(folder)).filter(name => name.endsWith('.swift')).sort().map(name => file(path.join(folder, name), 'sourcecode.swift'));
    objects[group].children.push(...sources);
    const product = add({ isa: 'PBXFileReference', explicitFileType: 'wrapper.application', path: `${name}.app`, sourceTree: 'BUILT_PRODUCTS_DIR' }); objects[products].children.push(product);
    const google = add({ isa: 'XCSwiftPackageProductDependency', package: packageId, productName: 'GoogleSignIn' });
    const sourcePhase = add({ isa: 'PBXSourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...shared, ...sources]), runOnlyForDeploymentPostprocessing: 0 });
    const icon = file(await generateAppleIcons(output, platform), 'folder.assetcatalog'); objects[group].children.push(icon);
    const resourcePhase = add({ isa: 'PBXResourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...resources, icon]), runOnlyForDeploymentPostprocessing: 0 });
    const frameworkPhase = add({ isa: 'PBXFrameworksBuildPhase', buildActionMask: 2147483647, files: [add({ isa: 'PBXBuildFile', productRef: google })], runOnlyForDeploymentPostprocessing: 0 });
    const licensePhase = add({ isa: 'PBXShellScriptBuildPhase', name: 'Copy native dependency notices', buildActionMask: 2147483647,
      files: [], inputPaths: ['$(WORK_FLEET_ROOT)/scripts/macos/copy-native-notices.sh', '$(WORK_FLEET_PACKAGES_DIR)/checkouts'],
      outputPaths: ['$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/Licenses'], runOnlyForDeploymentPostprocessing: 0,
      shellPath: '/bin/bash', shellScript: 'bash "$WORK_FLEET_ROOT/scripts/macos/copy-native-notices.sh" "$WORK_FLEET_PACKAGES_DIR/checkouts" "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Licenses"\n' });
    const id = add({ isa: 'PBXNativeTarget', name, productName: name, productReference: product, productType: 'com.apple.product-type.application',
      buildConfigurationList: configs(mode => settings(platform, mode)), buildPhases: [sourcePhase, frameworkPhase, resourcePhase, licensePhase],
      buildRules: [], dependencies: [], packageProductDependencies: [google] }); targets.push(id);
    if (platform === 'ios') iosTarget = id;
    const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${name}.app" BlueprintName="${name}" ReferencedContainer="container:WorkFleet.xcodeproj"/>`;
    await writeFile(path.join(project, 'xcshareddata', 'xcschemes', `${name}.xcscheme`), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n`);
    const client = config.google.clients[platform]; const scheme = client ? client.split('.').reverse().join('.') : '';
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const captureInfo = platform === 'ios' ? `<key>FleetCaptureAppGroup</key><string>${escape(config.appleAppGroupId)}</string>` : '';
    await writeFile(path.join(output, `${platform}-Info.plist`), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>Work Fleet</string><key>CFBundleDisplayName</key><string>Work Fleet</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>10000</string><key>GIDClientID</key><string>${escape(client)}</string>${captureInfo}${scheme ? `<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>${escape(scheme)}</string></array></dict></array>` : ''}${platform === 'ios' ? '<key>LSRequiresIPhoneOS</key><true/><key>UILaunchScreen</key><dict/><key>UISupportedInterfaceOrientations</key><array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>' : '<key>NSPrincipalClass</key><string>NSApplication</string><key>LSMinimumSystemVersion</key><string>13.0</string>'}</dict></plist>\n`);
  }
  const shareSource = file(path.join(root, 'src', 'native', 'apple', 'share', 'ShareViewController.swift'), 'sourcecode.swift'); objects[group].children.push(shareSource);
  const shareShared = shared.filter(ref => ['FleetProtocol.swift', 'FleetCaptureInbox.swift'].includes(path.basename(objects[ref].path)));
  const shareProduct = add({ isa: 'PBXFileReference', explicitFileType: 'wrapper.app-extension', path: 'WorkFleetShare.appex', sourceTree: 'BUILT_PRODUCTS_DIR' }); objects[products].children.push(shareProduct);
  const shareTarget = add({ isa: 'PBXNativeTarget', name: 'WorkFleetShare', productName: 'WorkFleetShare', productReference: shareProduct, productType: 'com.apple.product-type.app-extension',
    buildConfigurationList: configs(mode => ({ ...settings('ios', mode), PRODUCT_BUNDLE_IDENTIFIER: `${config.appId || 'app.workfleet.preview'}.share`,
      INFOPLIST_FILE: path.join(output, 'share-Info.plist'), CODE_SIGN_ENTITLEMENTS: path.join(root, 'src', 'native', 'apple', 'share', 'WorkFleet.entitlements'),
      APPLICATION_EXTENSION_API_ONLY: 'YES', SKIP_INSTALL: 'YES', ASSETCATALOG_COMPILER_APPICON_NAME: '', OTHER_LDFLAGS: ['$(inherited)'] })),
    buildPhases: [add({ isa: 'PBXSourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...shareShared, shareSource]), runOnlyForDeploymentPostprocessing: 0 }),
      add({ isa: 'PBXFrameworksBuildPhase', buildActionMask: 2147483647, files: [], runOnlyForDeploymentPostprocessing: 0 }),
      add({ isa: 'PBXResourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles(resources.filter(ref => ['PrivacyInfo.xcprivacy', 'LICENSE', 'THIRD-PARTY-NOTICES.md'].includes(path.basename(objects[ref].path)))), runOnlyForDeploymentPostprocessing: 0 })],
    buildRules: [], dependencies: [], packageProductDependencies: [] }); targets.push(shareTarget);
  const proxy = add({ isa: 'PBXContainerItemProxy', containerPortal: projectId, proxyType: 1, remoteGlobalIDString: shareTarget, remoteInfo: 'WorkFleetShare' });
  objects[iosTarget].dependencies.push(add({ isa: 'PBXTargetDependency', target: shareTarget, targetProxy: proxy }));
  objects[iosTarget].buildPhases.push(add({ isa: 'PBXCopyFilesBuildPhase', name: 'Embed Share Extension', buildActionMask: 2147483647, dstPath: '', dstSubfolderSpec: 13,
    files: [add({ isa: 'PBXBuildFile', fileRef: shareProduct, settings: { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] } })], runOnlyForDeploymentPostprocessing: 0 }));
  await writeFile(path.join(output, 'share-Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>Work Fleet</string><key>CFBundleDisplayName</key><string>Work Fleet</string><key>CFBundlePackageType</key><string>XPC!</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>10000</string><key>FleetCaptureAppGroup</key><string>${config.appleAppGroupId}</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.share-services</string><key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).ShareViewController</string><key>NSExtensionAttributes</key><dict><key>NSExtensionActivationRule</key><dict><key>NSExtensionActivationSupportsText</key><true/><key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsFileWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsImageWithMaxCount</key><integer>16</integer><key>NSExtensionActivationSupportsMovieWithMaxCount</key><integer>16</integer></dict></dict></dict></dict></plist>\n`);
  objects[projectId] = { isa: 'PBXProject', attributes: { LastUpgradeCheck: '1600' }, buildConfigurationList: configs(() => ({})), compatibilityVersion: 'Xcode 14.0',
    developmentRegion: 'en', hasScannedForEncodings: 0, knownRegions: ['en', 'zh-Hant', 'Base'], mainGroup: group, productRefGroup: products,
    projectDirPath: '', projectRoot: '', targets, packageReferences: [packageId] };
  const serialize = value => Array.isArray(value) ? value.length ? `(${value.map(serialize).join(', ')},)` : '()'
    : value && typeof value === 'object' ? `{\n${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${serialize(item)};`).join('\n')}\n}`
      : typeof value === 'number' ? String(value) : JSON.stringify(value);
  await writeFile(path.join(project, 'project.pbxproj'), '// !$*UTF8*$!\n' + serialize({ archiveVersion: 1, classes: {}, objectVersion: 56, objects, rootObject: projectId }) + '\n');
  console.log('Generated build/apple/WorkFleet.xcodeproj (macOS and iOS).');
}
