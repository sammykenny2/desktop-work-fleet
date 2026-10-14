/** Maintain the checked-in macOS/iOS Xcode project. Usage: node scripts/generate-apple-project.mjs [--help] */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppleIcons } from './apple-icons.mjs';

export async function generateAppleProject(root = fileURLToPath(new URL('../', import.meta.url))) {
  const output = path.join(root, 'src', 'native', 'apple');
  const project = path.join(output, 'WorkFleet.xcodeproj');
  await mkdir(path.join(project, 'xcshareddata', 'xcschemes'), { recursive: true });
  await mkdir(path.join(project, 'project.xcworkspace'), { recursive: true });
  await writeFile(path.join(project, 'project.xcworkspace', 'contents.xcworkspacedata'), '<?xml version="1.0" encoding="UTF-8"?>\n<Workspace version="1.0"><FileRef location="self:"/></Workspace>\n');
  const objects = {}; let counter = 0;
  const add = object => { const id = (++counter).toString(16).toUpperCase().padStart(24, '0'); objects[id] = object; return id; };
  const projectId = add({});
  const file = (name, type) => add({ isa: 'PBXFileReference', lastKnownFileType: type,
    path: path.relative(output, name).split(path.sep).join('/'), sourceTree: 'SOURCE_ROOT' });
  const shared = (await readdir(path.join(root, 'src', 'native', 'apple', 'Shared'))).filter(name => name.endsWith('.swift')).sort()
    .map(name => file(path.join(root, 'src', 'native', 'apple', 'Shared', name), 'sourcecode.swift'));
  const resources = [file(path.join(root, 'src', 'native', 'apple', 'PrivacyInfo.xcprivacy'), 'text.xml'),
    file(path.join(root, 'LICENSE'), 'text'), file(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'text')];
  const packageId = add({ isa: 'XCRemoteSwiftPackageReference', repositoryURL: 'https://github.com/google/GoogleSignIn-iOS',
    requirement: { kind: 'exactVersion', version: '9.2.0' } });
  // ADR-044: macOS updates through Sparkle; the iOS target and any future App Store build do not link it.
  const sparkleId = add({ isa: 'XCRemoteSwiftPackageReference', repositoryURL: 'https://github.com/sparkle-project/Sparkle',
    requirement: { kind: 'exactVersion', version: '2.10.0' } });
  const group = add({ isa: 'PBXGroup', children: [...shared, ...resources], sourceTree: '<group>' });
  const products = add({ isa: 'PBXGroup', children: [], name: 'Products', sourceTree: '<group>' }); objects[group].children.push(products);
  const baseConfig = file(path.join(output, 'config', 'WorkFleet.xcconfig'), 'text.xcconfig'); objects[group].children.push(baseConfig);
  const settings = (platform, mode) => ({
    SWIFT_VERSION: '5.0', SWIFT_STRICT_CONCURRENCY: 'minimal', CLANG_ENABLE_MODULES: 'YES',
    SWIFT_OPTIMIZATION_LEVEL: mode === 'Release' ? '-O' : '-Onone', DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
    PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: '$(WORK_FLEET_APP_ID)', CODE_SIGN_STYLE: 'Automatic',
    CODE_SIGN_ENTITLEMENTS: `$(SRCROOT)/${platform}/WorkFleet.entitlements`,
    INFOPLIST_FILE: '$(SRCROOT)/.generated/$(TARGET_NAME)/Info.plist', GENERATE_INFOPLIST_FILE: 'NO',
    OTHER_LDFLAGS: ['$(inherited)', '-lsqlite3'], ENABLE_USER_SCRIPT_SANDBOXING: 'NO', ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
    WORK_FLEET_ROOT: '$(SRCROOT)/../../..', WORK_FLEET_PACKAGES_DIR: '$(BUILD_DIR)/../../SourcePackages',
    ...(platform === 'macos' ? { SDKROOT: 'macosx', MACOSX_DEPLOYMENT_TARGET: '13.0', SUPPORTED_PLATFORMS: 'macosx', ENABLE_HARDENED_RUNTIME: 'YES' }
      : { SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: '16.0', TARGETED_DEVICE_FAMILY: '1,2', SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator', SUPPORTS_MACCATALYST: 'NO' }),
    ...(platform === 'macos' && mode === 'Release' ? { CODE_SIGN_STYLE: '$(WORK_FLEET_MACOS_SIGNING_STYLE)',
      CODE_SIGN_IDENTITY: '$(WORK_FLEET_MACOS_SIGNING_IDENTITY)', PROVISIONING_PROFILE_SPECIFIER: '$(WORK_FLEET_MACOS_PROFILE)' } : {}),
  });
  const configs = fn => add({ isa: 'XCConfigurationList', buildConfigurations: ['Debug', 'Release'].map(name =>
    add({ isa: 'XCBuildConfiguration', name, baseConfigurationReference: baseConfig, buildSettings: fn(name) })), defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release' });
  const targets = [];
  const buildFiles = refs => refs.map(fileRef => add({ isa: 'PBXBuildFile', fileRef }));
  const preparePhase = (platform, name) => add({ isa: 'PBXShellScriptBuildPhase', name: 'Prepare local resources', buildActionMask: 2147483647,
    files: [], alwaysOutOfDate: 1, inputPaths: ['$(WORK_FLEET_ROOT)/scripts/macos/prepare-apple-assets.sh', '$(WORK_FLEET_ROOT)/scripts/prepare-apple-build.mjs'],
    outputPaths: [`$(SRCROOT)/.generated/${name}/Info.plist`, ...(platform === 'share' ? [] : [`$(SRCROOT)/.generated/${name}/Assets`, `$(SRCROOT)/.generated/${name}/Config`])],
    runOnlyForDeploymentPostprocessing: 0, shellPath: '/bin/bash',
    shellScript: `bash "$WORK_FLEET_ROOT/scripts/macos/prepare-apple-assets.sh" ${platform} "$SRCROOT/.generated/${name}"\n` });
  let iosTarget;
  for (const platform of ['macos', 'ios']) {
    const name = platform === 'macos' ? 'WorkFleetMac' : 'WorkFleetIOS';
    const folder = path.join(root, 'src', 'native', 'apple', platform);
    const sources = (await readdir(folder)).filter(name => name.endsWith('.swift')).sort().map(name => file(path.join(folder, name), 'sourcecode.swift'));
    objects[group].children.push(...sources);
    const product = add({ isa: 'PBXFileReference', explicitFileType: 'wrapper.application', path: `${name}.app`, sourceTree: 'BUILT_PRODUCTS_DIR' }); objects[products].children.push(product);
    const google = add({ isa: 'XCSwiftPackageProductDependency', package: packageId, productName: 'GoogleSignIn' });
    const sourcePhase = add({ isa: 'PBXSourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...shared, ...sources]), runOnlyForDeploymentPostprocessing: 0 });
    const icon = file(await generateAppleIcons(path.join(output, 'resources'), platform), 'folder.assetcatalog'); objects[group].children.push(icon);
    const generated = ['Assets', 'Config'].map(folder => file(path.join(output, '.generated', name, folder), 'folder')); objects[group].children.push(...generated);
    const resourcePhase = add({ isa: 'PBXResourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...resources, ...generated, icon]), runOnlyForDeploymentPostprocessing: 0 });
    const sparkle = platform === 'macos' ? add({ isa: 'XCSwiftPackageProductDependency', package: sparkleId, productName: 'Sparkle' }) : null;
    const frameworkPhase = add({ isa: 'PBXFrameworksBuildPhase', buildActionMask: 2147483647,
      files: [google, ...(sparkle ? [sparkle] : [])].map(productRef => add({ isa: 'PBXBuildFile', productRef })), runOnlyForDeploymentPostprocessing: 0 });
    const licensePhase = add({ isa: 'PBXShellScriptBuildPhase', name: 'Copy native dependency notices', buildActionMask: 2147483647,
      files: [], inputPaths: ['$(WORK_FLEET_ROOT)/scripts/macos/copy-native-notices.sh', '$(WORK_FLEET_PACKAGES_DIR)/checkouts'],
      outputPaths: ['$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/Licenses'], runOnlyForDeploymentPostprocessing: 0,
      shellPath: '/bin/bash', shellScript: 'bash "$WORK_FLEET_ROOT/scripts/macos/copy-native-notices.sh" "$WORK_FLEET_PACKAGES_DIR/checkouts" "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Licenses"\n' });
    const id = add({ isa: 'PBXNativeTarget', name, productName: name, productReference: product, productType: 'com.apple.product-type.application',
      buildConfigurationList: configs(mode => settings(platform, mode)), buildPhases: [preparePhase(platform, name), sourcePhase, frameworkPhase, resourcePhase, licensePhase],
      buildRules: [], dependencies: [], packageProductDependencies: [google, ...(sparkle ? [sparkle] : [])] }); targets.push(id);
    if (platform === 'ios') iosTarget = id;
    const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${name}.app" BlueprintName="${name}" ReferencedContainer="container:WorkFleet.xcodeproj"/>`;
    await writeFile(path.join(project, 'xcshareddata', 'xcschemes', `${name}.xcscheme`), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>\n`);
  }
  const shareSource = file(path.join(root, 'src', 'native', 'apple', 'share', 'ShareViewController.swift'), 'sourcecode.swift'); objects[group].children.push(shareSource);
  const shareShared = shared.filter(ref => ['FleetProtocol.swift', 'FleetCaptureInbox.swift'].includes(path.basename(objects[ref].path)));
  const shareProduct = add({ isa: 'PBXFileReference', explicitFileType: 'wrapper.app-extension', path: 'WorkFleetShare.appex', sourceTree: 'BUILT_PRODUCTS_DIR' }); objects[products].children.push(shareProduct);
  const shareTarget = add({ isa: 'PBXNativeTarget', name: 'WorkFleetShare', productName: 'WorkFleetShare', productReference: shareProduct, productType: 'com.apple.product-type.app-extension',
    buildConfigurationList: configs(mode => ({ ...settings('ios', mode), PRODUCT_BUNDLE_IDENTIFIER: '$(WORK_FLEET_APP_ID).share',
      CODE_SIGN_ENTITLEMENTS: '$(SRCROOT)/share/WorkFleet.entitlements',
      APPLICATION_EXTENSION_API_ONLY: 'YES', SKIP_INSTALL: 'YES', ASSETCATALOG_COMPILER_APPICON_NAME: '', OTHER_LDFLAGS: ['$(inherited)'] })),
    buildPhases: [preparePhase('share', 'WorkFleetShare'), add({ isa: 'PBXSourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles([...shareShared, shareSource]), runOnlyForDeploymentPostprocessing: 0 }),
      add({ isa: 'PBXFrameworksBuildPhase', buildActionMask: 2147483647, files: [], runOnlyForDeploymentPostprocessing: 0 }),
      add({ isa: 'PBXResourcesBuildPhase', buildActionMask: 2147483647, files: buildFiles(resources.filter(ref => ['PrivacyInfo.xcprivacy', 'LICENSE', 'THIRD-PARTY-NOTICES.md'].includes(path.basename(objects[ref].path)))), runOnlyForDeploymentPostprocessing: 0 })],
    buildRules: [], dependencies: [], packageProductDependencies: [] }); targets.push(shareTarget);
  const proxy = add({ isa: 'PBXContainerItemProxy', containerPortal: projectId, proxyType: 1, remoteGlobalIDString: shareTarget, remoteInfo: 'WorkFleetShare' });
  objects[iosTarget].dependencies.push(add({ isa: 'PBXTargetDependency', target: shareTarget, targetProxy: proxy }));
  objects[iosTarget].buildPhases.push(add({ isa: 'PBXCopyFilesBuildPhase', name: 'Embed Share Extension', buildActionMask: 2147483647, dstPath: '', dstSubfolderSpec: 13,
    files: [add({ isa: 'PBXBuildFile', fileRef: shareProduct, settings: { ATTRIBUTES: ['CodeSignOnCopy', 'RemoveHeadersOnCopy'] } })], runOnlyForDeploymentPostprocessing: 0 }));
  objects[projectId] = { isa: 'PBXProject', attributes: { LastUpgradeCheck: '1600' }, buildConfigurationList: configs(() => ({})), compatibilityVersion: 'Xcode 14.0',
    developmentRegion: 'en', hasScannedForEncodings: 0, knownRegions: ['en', 'zh-Hant', 'Base'], mainGroup: group, productRefGroup: products,
    projectDirPath: '', projectRoot: '', targets, packageReferences: [packageId, sparkleId] };
  const serialize = value => Array.isArray(value) ? value.length ? `(${value.map(serialize).join(', ')},)` : '()'
    : value && typeof value === 'object' ? `{\n${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${serialize(item)};`).join('\n')}\n}`
      : typeof value === 'number' ? String(value) : JSON.stringify(value);
  await writeFile(path.join(project, 'project.pbxproj'), '// !$*UTF8*$!\n' + serialize({ archiveVersion: 1, classes: {}, objectVersion: 56, objects, rootObject: projectId }) + '\n');
  return { project, objects };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/generate-apple-project.mjs\nMaintains src/native/apple/WorkFleet.xcodeproj and icons. Not required to open or build a checkout.');
  } else {
    const { project } = await generateAppleProject();
    console.log(`Updated ${project} (portable macOS and iOS project).`);
  }
}
