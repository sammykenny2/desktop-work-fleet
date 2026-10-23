/**
 * Check the files of one vX.Y.Z preview release before it is published (ADR-044).
 * Usage: node scripts/validate-release-assets.mjs --dir DIR --version X.Y.Z --repository OWNER/REPO [--help]
 * The release carries every platform, so the folder must hold exactly the expected files. Each .sha256 matches its file,
 * each desktop update manifest names this release and files in it by size and SHA-256, and the Sparkle appcast points
 * at the macOS archive in this release. The release workflow uploads the folder only after this passes.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The desktop hosts read these by name; tests/fixtures/update-feed.json lists the same names.
export const manifestNames = { windows: 'work-fleet-update-windows.json', linux: 'work-fleet-update-linux.json', macos: 'work-fleet-update-macos.json' };

/** Every file one release carries, by platform. */
export function releaseAssets(version) {
  return {
    windows: [`WorkFleet-${version}-x64.msix`, `WorkFleet-${version}-x64.msix.sha256`, 'WorkFleet-preview.cer', manifestNames.windows],
    linux: [`work-fleet_${version}_all.deb`, `work-fleet_${version}_all.deb.sha256`, manifestNames.linux],
    macos: [`WorkFleet-${version}-macos-universal.dmg`, `WorkFleet-${version}-macos-universal.dmg.sha256`,
      `WorkFleet-${version}-macos-universal.zip`, `WorkFleet-${version}-macos-universal.zip.sha256`, 'appcast.xml', manifestNames.macos],
    android: [`WorkFleet-${version}-android-debug.apk`, `WorkFleet-${version}-android-debug.apk.sha256`],
  };
}

/** The installer each desktop manifest names, for the architecture its host asks for. */
export function installers(version) {
  return {
    windows: { arch: 'x64', file: `WorkFleet-${version}-x64.msix` },
    linux: { arch: 'all', file: `work-fleet_${version}_all.deb` },
    macos: { arch: 'universal', file: `WorkFleet-${version}-macos-universal.zip` },
  };
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function validateReleaseAssets({ dir, version, repository }) {
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version ?? '')) throw new Error('--version must be x.y.z');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repository ?? '')) throw new Error('--repository must be owner/repo');
  const tag = `v${version}`; const problems = [];
  const expected = Object.values(releaseAssets(version)).flat();
  const present = (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name);
  for (const name of expected) if (!present.includes(name)) problems.push(`missing ${name}`);
  for (const name of present) if (!expected.includes(name)) problems.push(`unexpected ${name}`);
  if (problems.length) throw new Error(`Release ${tag} files: ${problems.join('; ')}.`);
  const bytes = new Map();
  for (const name of expected) bytes.set(name, await readFile(path.join(dir, name)));

  for (const name of expected.filter(file => file.endsWith('.sha256'))) {
    const target = name.slice(0, -'.sha256'.length);
    const [hash, file] = bytes.get(name).toString('utf8').trim().split(/\s+\*?/);
    if (file !== target || hash !== digest(bytes.get(target))) problems.push(`${name} does not match ${target}`);
  }
  for (const [platform, name] of Object.entries(manifestNames)) {
    let manifest;
    try { manifest = JSON.parse(bytes.get(name).toString('utf8')); } catch { problems.push(`${name} is not JSON`); continue; }
    if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.version !== version || manifest.tag !== tag) {
      problems.push(`${name} does not describe ${platform} ${tag}`);
    }
    // The hosts pick the one entry for their architecture and install what it names, so it must be this platform's
    // installer; a consistent entry for the certificate or another architecture would fail only on the user's machine.
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const { arch, file: installer } = installers(version)[platform];
    const asset = assets[0];
    if (assets.length !== 1 || asset?.arch !== arch || asset?.name !== installer) {
      problems.push(`${name} must list exactly ${installer} for ${arch}`);
    } else if (asset.size !== bytes.get(installer).length || asset.sha256 !== digest(bytes.get(installer))) {
      problems.push(`${name} has the wrong size or SHA-256 for ${installer}`);
    }
  }
  const archive = `WorkFleet-${version}-macos-universal.zip`;
  const appcast = bytes.get('appcast.xml').toString('utf8');
  const enclosure = /<enclosure\s+url="([^"]+)"\s+length="(\d+)"/.exec(appcast);
  if (!enclosure || enclosure[1] !== `https://github.com/${repository}/releases/download/${tag}/${archive}`
    || Number(enclosure[2]) !== bytes.get(archive).length) problems.push(`appcast.xml does not point at ${archive} in ${tag}`);
  if (!appcast.includes(`<sparkle:shortVersionString>${version}</sparkle:shortVersionString>`)) problems.push(`appcast.xml is not for ${version}`);
  if (problems.length) throw new Error(`Release ${tag}: ${problems.join('; ')}.`);
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, dir: { type: 'string' }, version: { type: 'string' }, repository: { type: 'string' } } });
  if (values.help) {
    console.log('Usage: node scripts/validate-release-assets.mjs --dir DIR --version X.Y.Z --repository OWNER/REPO\nChecks the files of the vX.Y.Z release before it is published.');
  } else {
    if (!values.dir) throw new Error('Missing --dir. Use --help.');
    const files = await validateReleaseAssets(values);
    console.log(`Release v${values.version}: ${files.length} files checked.`);
  }
}
