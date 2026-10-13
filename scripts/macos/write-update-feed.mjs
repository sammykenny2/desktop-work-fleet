/**
 * Write the macOS release's Sparkle appcast.xml and work-fleet-update.json (ADR-044).
 * Usage: node scripts/macos/write-update-feed.mjs --archive ZIP --signature "sparkle:edSignature=... length=..." --version X.Y.Z
 *   --build N --repository OWNER/REPO --output DIR [--summary TEXT] [--help]
 * The signature line is what Sparkle's sign_update prints for the archive. The enclosure URL is the archive's download
 * address in the macos-vX.Y.Z GitHub release, so the release must carry the archive under the same name.
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function writeUpdateFeed({ archive, signature, version, build, repository, output, summary = '', now = new Date() }) {
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version)) throw new Error('version must be x.y.z');
  if (!/^[1-9]\d{0,8}$/.test(String(build))) throw new Error('build must be the CFBundleVersion number');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(repository)) throw new Error('repository must be owner/repo');
  if (summary.length > 500) throw new Error('summary must be at most 500 characters');
  const match = /sparkle:edSignature="([A-Za-z0-9+/=]{40,200})"\s+length="(\d+)"/.exec(signature);
  if (!match) throw new Error('signature must be the sign_update output line');
  const bytes = await readFile(archive); const size = (await stat(archive)).size;
  if (Number(match[2]) !== size) throw new Error('sign_update length does not match the archive');
  const name = path.basename(archive); const tag = `macos-v${version}`;
  const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  const appcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Work Fleet for macOS</title>
    <item>
      <title>Work Fleet ${escape(version)}</title>
      <pubDate>${now.toUTCString()}</pubDate>
      <sparkle:version>${escape(build)}</sparkle:version>
      <sparkle:shortVersionString>${escape(version)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <description>${escape(summary)}</description>
      <enclosure url="${escape(url)}" length="${size}" type="application/octet-stream" sparkle:edSignature="${escape(match[1])}"/>
    </item>
  </channel>
</rss>
`;
  const manifest = { schemaVersion: 1, platform: 'macos', version, tag, summary,
    assets: [{ arch: 'universal', name, size, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  await writeFile(path.join(output, 'appcast.xml'), appcast);
  await writeFile(path.join(output, 'work-fleet-update.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { appcast, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/macos/write-update-feed.mjs --archive ZIP --signature LINE --version X.Y.Z --build N --repository OWNER/REPO --output DIR [--summary TEXT]');
  } else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]?.replace(/^--/, ''); if (!['archive', 'signature', 'version', 'build', 'repository', 'output', 'summary'].includes(key) || args[i + 1] === undefined) throw new Error('Use --help.');
      options[key] = args[i + 1];
    }
    for (const key of ['archive', 'signature', 'version', 'build', 'repository', 'output']) if (!options[key]) throw new Error(`Missing --${key}. Use --help.`);
    await writeUpdateFeed(options);
    console.log(`Wrote appcast.xml and work-fleet-update.json in ${options.output}`);
  }
}
