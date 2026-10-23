/**
 * Print a platform's recorded release version, or with --release the one version all four record.
 * Usage: node scripts/platform-version.mjs --platform linux|windows|apple|android | --release
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// Each platform records its own version; packaging derives file names from it and never from the build machine.
export const versionRecords = {
  linux: 'src/native/linux/VERSION',
  windows: 'src/native/windows/Directory.Build.props',
  apple: 'src/native/apple/config/WorkFleet.xcconfig',
  android: 'src/native/android/app/build.gradle.kts',
};
const patterns = {
  windows: /<Version>([^<]*)<\/Version>/,
  android: /^\s*versionName = "([^"]*)"$/m,
};

const numeric = (value, file, name) => {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) throw new Error(`${file} must record ${name} as numeric x.y.z.`);
  return value;
};

export async function readAppleVersion(root = repositoryRoot) {
  const text = await readFile(path.join(root, versionRecords.apple), 'utf8');
  const setting = name => text.match(new RegExp(`^${name} = (\\S+)$`, 'm'))?.[1];
  const build = setting('CURRENT_PROJECT_VERSION');
  if (!/^\d+$/.test(build ?? '')) throw new Error(`${versionRecords.apple} must record CURRENT_PROJECT_VERSION as an integer.`);
  return { version: numeric(setting('MARKETING_VERSION'), versionRecords.apple, 'MARKETING_VERSION'), build };
}

export async function readPlatformVersion(platform, root = repositoryRoot) {
  if (platform === 'apple') return (await readAppleVersion(root)).version;
  const file = versionRecords[platform];
  if (!file) throw new Error('Specify --platform linux|windows|apple|android.');
  const text = await readFile(path.join(root, file), 'utf8');
  return numeric(platform === 'linux' ? text.trim() : text.match(patterns[platform])?.[1], file, 'the version');
}

// One vX.Y.Z release carries every platform (ADR-044), so it starts only when the four records agree.
export async function readReleaseVersion(root = repositoryRoot) {
  const versions = {};
  for (const platform of Object.keys(versionRecords)) versions[platform] = await readPlatformVersion(platform, root);
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1) {
    throw new Error(`One release needs one version, but the records differ: ${Object.entries(versions).map(([name, value]) => `${name} ${value}`).join(', ')}.`);
  }
  return [...distinct][0];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(`Usage: node scripts/platform-version.mjs --platform linux|windows|apple|android | --release
Prints the version recorded for that platform in the repository, or with --release the version all four record,
failing when they differ.`);
  } else if (args.length === 1 && args[0] === '--release') {
    console.log(await readReleaseVersion());
  } else {
    if (args.length !== 2 || args[0] !== '--platform') throw new Error('Use --help.');
    console.log(await readPlatformVersion(args[1]));
  }
}
