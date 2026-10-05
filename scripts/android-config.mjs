/** Public configuration for Gradle sync. Usage: node scripts/android-config.mjs [--check-release] */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { missingReleaseConfig, readBuildConfig } from './config.mjs';

export async function readAndroidBuildConfig(root = new URL('../', import.meta.url), environment = process.env, release = false) {
  const config = await readBuildConfig(root, environment);
  if (release) {
    const missing = missingReleaseConfig(config, 'android');
    if (missing.length) throw new Error(`Android release settings are incomplete: ${missing.join(', ')}. Configure .env and sync Gradle again.`);
  }
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'check-release': { type: 'boolean' } } });
  const config = await readAndroidBuildConfig(undefined, undefined, values['check-release']);
  console.log(values['check-release'] ? 'Android release public settings complete.' : JSON.stringify(config));
}
