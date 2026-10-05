import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateAppleProject } from '../scripts/generate-apple-project.mjs';
import { prepareAppleBuild } from '../scripts/prepare-apple-build.mjs';

async function fixture(root) {
  for (const file of ['src/native/apple/Shared/FleetProtocol.swift', 'src/native/apple/Shared/FleetCaptureInbox.swift',
    'src/native/apple/ios/Main.swift', 'src/native/apple/macos/Main.swift', 'src/native/apple/share/ShareViewController.swift',
    'src/native/apple/PrivacyInfo.xcprivacy', 'src/native/apple/config/WorkFleet.xcconfig', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'fixture\n');
  }
}

test('Xcode project is location independent and does not embed local configuration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-apple-project-'));
  try {
    const roots = [path.join(directory, 'first checkout'), path.join(directory, 'moved checkout')];
    const projects = [];
    for (const root of roots) {
      await fixture(root);
      await writeFile(path.join(root, '.env'), 'WORK_FLEET_APP_ID=app.private.fixture\nPRIVATE_TOKEN=synthetic-secret\n');
      const { project, objects } = await generateAppleProject(root);
      const text = await readFile(path.join(project, 'project.pbxproj'), 'utf8');
      assert.equal(text.includes(root), false);
      assert.equal(text.includes('app.private.fixture'), false);
      assert.equal(text.includes('synthetic-secret'), false);
      for (const object of Object.values(objects)) {
        if (object.isa === 'PBXFileReference' && object.sourceTree === 'SOURCE_ROOT') {
          assert.equal(path.isAbsolute(object.path), false);
          assert.equal(object.path.includes('\\'), false);
          if (!object.path.startsWith('.generated/')) await access(path.resolve(path.join(root, 'src/native/apple'), object.path));
        }
      }
      const targets = Object.values(objects).filter(object => object.isa === 'PBXNativeTarget');
      assert.deepEqual(targets.map(target => target.name).sort(), ['WorkFleetIOS', 'WorkFleetMac', 'WorkFleetShare']);
      for (const target of targets) assert.equal(objects[target.buildPhases[0]].name, 'Prepare local resources');
      const ios = targets.find(target => target.name === 'WorkFleetIOS');
      assert.equal(ios.dependencies.length, 1);
      assert.ok(ios.buildPhases.some(id => objects[id].name === 'Embed Share Extension'));
      for (const scheme of ['WorkFleetIOS', 'WorkFleetMac']) await access(path.join(project, 'xcshareddata/xcschemes', `${scheme}.xcscheme`));
      await access(path.join(project, 'project.xcworkspace/contents.xcworkspacedata'));
      projects.push(text);
    }
    assert.equal(projects[0], projects[1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Apple build prepares fresh bundle resources and keeps share extension free of app config', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-apple-assets-'));
  try {
    const environment = {
      WORK_FLEET_APP_ID: 'app.workfleet.ios', WORK_FLEET_APP_GROUP_ID: 'group.app.workfleet.ios',
      DEVELOPMENT_TEAM: 'ABCDE12345', WORK_FLEET_GOOGLE_IOS_CLIENT_ID: '123-ios.apps.googleusercontent.com',
      PRIVATE_TOKEN: 'synthetic-secret', CONFIGURATION: 'Debug',
    };
    const app = path.join(directory, 'App with spaces');
    const config = await prepareAppleBuild({ platform: 'ios', output: app, environment, installDependencies: false });
    assert.equal(config.appleTeamId, environment.DEVELOPMENT_TEAM);
    const plist = await readFile(path.join(app, 'Info.plist'), 'utf8');
    assert.ok(plist.includes('com.googleusercontent.apps.123-ios'));
    assert.ok(plist.includes('group.app.workfleet.ios'));
    const bundled = await readFile(path.join(app, 'Config/public.json'), 'utf8');
    assert.equal(JSON.parse(bundled).appId, environment.WORK_FLEET_APP_ID);
    assert.equal(bundled.includes('synthetic-secret'), false);
    for (const file of ['app/index.html', 'native/files.js', 'native/capture.js', 'vendor/marked.js']) await access(path.join(app, 'Assets', file));
    const share = path.join(directory, 'Share');
    await prepareAppleBuild({ platform: 'share', output: share, environment });
    const sharePlist = await readFile(path.join(share, 'Info.plist'), 'utf8');
    assert.ok(sharePlist.includes('com.apple.share-services'));
    assert.ok(sharePlist.includes('group.app.workfleet.ios'));
    assert.equal(sharePlist.includes(environment.WORK_FLEET_GOOGLE_IOS_CLIENT_ID), false);
    await assert.rejects(access(path.join(share, 'Config')));
    await assert.rejects(access(path.join(share, 'Assets')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Xcode release resource preparation rejects incomplete public settings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-apple-release-'));
  try {
    await assert.rejects(prepareAppleBuild({ platform: 'ios', root: directory, output: path.join(directory, 'output'),
      environment: { CONFIGURATION: 'Release' } }), /Apple release settings are incomplete/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
