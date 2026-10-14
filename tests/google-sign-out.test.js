import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// ADR-021 (amended 2026-10-15): Google's revocation removes the project's grant for every client, so a sign-out that
// revokes signs out every other device on the account within the hour. Each host forgets only its own credentials.
// Swift and Java do not build in every check environment, so the calls themselves are kept out of the sources.
test('no native host revokes the Google grant when signing out', async () => {
  const hosts = {
    windows: 'src/native/windows/app/NativeGoogle.cs',
    linux: 'src/native/linux/google.py',
    apple: 'src/native/apple/Shared/FleetGoogle.swift',
    android: 'src/native/android/app/src/main/java/app/workfleet/nativehost/GoogleFiles.java',
  };
  for (const [host, file] of Object.entries(hosts)) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const call of ['oauth2.googleapis.com/revoke', 'revokeAccess', 'GIDSignIn.sharedInstance.disconnect'])
      assert.ok(!source.includes(call), `${host} calls ${call}`);
  }
});
