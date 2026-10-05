import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAndroidBuildConfig } from '../scripts/android-config.mjs';
import { buildWebAssets } from '../scripts/build-web.mjs';

test('Android sync reads current .env settings without generated assets or private signing values', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-android-config-'));
  try {
    const root = pathToFileURL(directory + path.sep);
    assert.equal((await readAndroidBuildConfig(root, {})).appId, '');
    await writeFile(path.join(directory, '.env'), 'WORK_FLEET_APP_ID=app.workfleet.first\nPRIVATE_TOKEN=synthetic-token\n');
    assert.equal((await readAndroidBuildConfig(root, {})).appId, 'app.workfleet.first');
    await writeFile(path.join(directory, '.env'), 'WORK_FLEET_APP_ID=app.workfleet.changed\n');
    const updated = await readAndroidBuildConfig(root, { WORK_FLEET_ANDROID_STORE_PASSWORD: 'synthetic-password' });
    assert.equal(updated.appId, 'app.workfleet.changed');
    assert.equal(JSON.stringify(updated).includes('synthetic'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('direct Gradle release configuration rejects missing settings and accepts a complete public config', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-android-release-'));
  try {
    const root = pathToFileURL(directory + path.sep);
    await assert.rejects(readAndroidBuildConfig(root, {}, true), /WORK_FLEET_APP_ID/);
    const complete = {
      WORK_FLEET_APP_ID: 'app.workfleet.release', WORK_FLEET_GOOGLE_PROJECT_ID: 'synthetic-project',
      WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID: '123-android.apps.googleusercontent.com',
      WORK_FLEET_GOOGLE_WEB_CLIENT_ID: '123-web.apps.googleusercontent.com',
      WORK_FLEET_PRIVACY_URL: 'https://example.com/privacy', WORK_FLEET_SUPPORT_URL: 'https://example.com/support',
      WORK_FLEET_SUPPORT_EMAIL: 'support@example.com',
    };
    assert.equal((await readAndroidBuildConfig(root, complete, true)).appId, complete.WORK_FLEET_APP_ID);
    await assert.rejects(readAndroidBuildConfig(root, { ...complete, WORK_FLEET_GOOGLE_WEB_CLIENT_ID: '' }, true), /WORK_FLEET_GOOGLE_WEB_CLIENT_ID/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Android generated assets include the renderer, bridge modules, vendor imports and fresh public config', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-android-assets-'));
  try {
    const configDestination = path.join(directory, 'config', 'public.json');
    await buildWebAssets({ destination: directory, configDestination, environment: { WORK_FLEET_APP_ID: 'app.workfleet.generated' } });
    const html = await readFile(path.join(directory, 'app', 'index.html'), 'utf8');
    assert.equal(html.includes('IMPORT_MAP_HASH'), false);
    for (const relative of ['app/main.js', 'native/bridge.js', 'native/files.js', 'native/capture.js', 'native/google.js',
      'vendor/marked.js', 'vendor/dompurify.js', 'vendor/fflate.js', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
      assert.ok((await readFile(path.join(directory, relative))).length, relative);
    }
    const config = JSON.parse(await readFile(configDestination, 'utf8'));
    assert.equal(config.appId, 'app.workfleet.generated');
    assert.equal(Object.hasOwn(config, 'WORK_FLEET_ANDROID_STORE_PASSWORD'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
