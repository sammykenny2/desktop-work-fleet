import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { missingReleaseConfig, readBuildConfig } from '../scripts/config.mjs';

test('public config reads .env, prefers environment and excludes non-allowlisted credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'work-fleet-config-'));
  try {
    await writeFile(path.join(directory, '.env'), 'WORK_FLEET_GOOGLE_PROJECT_ID=file-project\nWORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID=123-file.apps.googleusercontent.com\nPRIVATE_TOKEN=synthetic-private-value\n');
    const config = await readBuildConfig(pathToFileURL(directory + path.sep), {
      WORK_FLEET_GOOGLE_PROJECT_ID: 'environment-project',
      WORK_FLEET_GOOGLE_WINDOWS_CLIENT_ID: '123-env.apps.googleusercontent.com',
      WORK_FLEET_APP_ID: 'test.workfleet.app', PRIVATE_KEY: 'synthetic-key',
      WORK_FLEET_WINDOWS_PACKAGE_ID: 'Test.WorkFleet', WORK_FLEET_WINDOWS_PUBLISHER: 'CN=Test Publisher',
      WORK_FLEET_PRIVACY_URL: 'https://example.com/privacy', WORK_FLEET_SUPPORT_URL: 'https://example.com/support',
      WORK_FLEET_SUPPORT_EMAIL: 'support@example.com',
    });
    assert.equal(config.google.projectId, 'environment-project');
    assert.equal(config.google.clients.windows, '123-env.apps.googleusercontent.com');
    assert.equal(JSON.stringify(config).includes('synthetic'), false);
    assert.deepEqual(missingReleaseConfig(config, 'windows'), []);
    assert.deepEqual(missingReleaseConfig(config, 'ios'), ['WORK_FLEET_GOOGLE_IOS_CLIENT_ID', 'WORK_FLEET_APPLE_TEAM_ID']);
  } finally { await rm(path.join(directory, '.env'), { force: true }); await rmdir(directory); }
});

test('empty config supports local builds but reports missing release values and rejects malformed IDs, URLs and email', async () => {
  const root = new URL('../build/nonexistent-config/', import.meta.url);
  const empty = await readBuildConfig(root, {});
  assert.deepEqual(missingReleaseConfig(empty, 'android'), ['WORK_FLEET_GOOGLE_PROJECT_ID', 'WORK_FLEET_GOOGLE_ANDROID_CLIENT_ID',
    'WORK_FLEET_GOOGLE_WEB_CLIENT_ID', 'WORK_FLEET_APP_ID', 'WORK_FLEET_PRIVACY_URL', 'WORK_FLEET_SUPPORT_URL', 'WORK_FLEET_SUPPORT_EMAIL']);
  assert.deepEqual(missingReleaseConfig(empty, 'windows').filter(name => name.startsWith('WORK_FLEET_WINDOWS_')),
    ['WORK_FLEET_WINDOWS_PACKAGE_ID', 'WORK_FLEET_WINDOWS_PUBLISHER']);
  for (const environment of [{ WORK_FLEET_GOOGLE_IOS_CLIENT_ID: 'not-an-id' },
    { WORK_FLEET_APP_ID: 'contains spaces' }, { WORK_FLEET_APP_ID: 'com.example.foo_bar' },
    { WORK_FLEET_APP_ID: 'com.example.foo-bar' }, { WORK_FLEET_APPLE_TEAM_ID: 'invalid' },
    { WORK_FLEET_GOOGLE_WEB_CLIENT_ID: 'not-an-id' }, { WORK_FLEET_WINDOWS_PACKAGE_ID: 'has spaces' },
    { WORK_FLEET_PRIVACY_URL: 'http://example.com/privacy' }, { WORK_FLEET_SUPPORT_URL: 'https://user:secret@example.com' },
    { WORK_FLEET_SUPPORT_EMAIL: 'not-an-email' }]) {
    await assert.rejects(readBuildConfig(root, environment));
  }
  assert.throws(() => missingReleaseConfig(empty, 'unknown'));
});
